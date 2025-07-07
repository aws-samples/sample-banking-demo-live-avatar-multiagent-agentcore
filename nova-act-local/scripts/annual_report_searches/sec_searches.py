import concurrent.futures
import os
import pandas as pd
from nova_act import NovaAct
from nova_act.types.act_errors import ActExceededMaxStepsError, ActError
from nova_act.util.jsonschema import BOOL_SCHEMA
from pydantic import BaseModel
import json
import re

SEC_SITE = 'https://www.sec.gov/'
REPORTS_TO_GET = ['2024', '2023']
TABLE_TO_FIND = 'Consolidated Statements of Comprehensive Income (Loss)'

class Pages(BaseModel):
    pages: int

class TableItem(BaseModel):
    description: str
    value: str

class Table(BaseModel):
    rows: list[TableItem]


def navigate_sec(headless ,logs_directory, record_video):
    # reports_page = ''

    with NovaAct(
            starting_page=SEC_SITE,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            preview={"playwright_actuation": True}
    ) as nova:
        nova.act("Find the search box and search for Amazon")
        nova.act("Click on the link for Filings on EDGAR to navigate to it. If you get a pop-up ask for feedback close it.")

        reports_page = nova.page.url
        print('current url', reports_page)

    result_array = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        # Start the load operations and mark each future with its URL
        future_to_report = {executor.submit(get_report_for_year, reports_page, year, headless, logs_directory, record_video): year for year in REPORTS_TO_GET}
        for future in concurrent.futures.as_completed(future_to_report):
            url = future_to_report[future]
            try:
                data = future.result()
                result_array.append(data)
                print('THREAD', data)
            except Exception as exc:
                print('%r generated an exception: %s' % (url, exc))
    print('result_array', result_array)
    final_output = {
        "format": "array",
        "data": result_array
    }
    write_output_log(None, f"Final results", final_output, 'final_output', logs_directory=logs_directory)


def get_report_for_year(report_page, report_year, headless, logs_directory, record_video):
    with NovaAct(
            starting_page=report_page,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            preview={"playwright_actuation": True}
    ) as nova:
        # change report_year to int and add 1
        report_year_inc = int(report_year) + 1
        nova.act("Expand the 10-K (annual reports) and 10-Q (quarterly reports) section")
        nova.act("Click the 'View all 10-Ks and 10-Qs' button")

        try:
            nova.act('Unselect the checkbox that says "Reporting date"')
            # nova.act(f'Open the 10-K Annual Report from the Filings table that has a reporting date in {report_year} and a filing date in {report_year_inc} by clicking on the form description link.', timeout=60)
            nova.act(f"Click on the link in the 'Form description' column of the row in the filings table that has a 'Form type' of '10K', and a 'Filing date' that starts with'{report_year_inc}'", timeout=60)

        except Exception as e:
            print(f"Error during act: {e}")
            current_page = nova.page.url
            print('PAGE', current_page)
            if '/ix?doc=' in current_page:
                #remove /ix?doc=/ from url
                new_url = current_page.replace('/ix?doc=', '')
                nova.go_to_url(new_url)
            else:
                raise e

        report_details = get_table_details_by_scrolling(nova, report_year)
        write_output_log(nova, f"{TABLE_TO_FIND} results", report_details, 'output', logs_directory=logs_directory)

        return report_details




def remove_first_two_dollar_amounts(text):
    # Find all dollar amounts in the format $number (with optional commas)
    dollar_pattern = r'\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?'
    matches = list(re.finditer(dollar_pattern, text))

    if len(matches) >= 3:
        # Remove the first two matches from the text
        # Work backwards to avoid index shifting
        for match in reversed(matches[:2]):
            # Remove the dollar amount and any preceding comma/space
            start = match.start()
            end = match.end()

            # Check for preceding comma and space
            if start > 0 and text[start-2:start] == ', ':
                start -= 2
            elif start > 0 and text[start-1] == ' ':
                start -= 1
            text = text[:start] + text[end:]
    return text

def get_table_details_by_scrolling(nova, year):
    try:
        instruction = f"Scroll down until you see the {TABLE_TO_FIND} table with dollar values for income and loss showing onscreen"
        scroll_based_on_instruction(nova, instruction, 1)
        result = nova.act(f"Capture the {year} values from the table as a list of key value pairs. The description is on the left and the value is in the {year} column", schema=Table.model_json_schema())
        print(result.parsed_response)
        final_result = result.parsed_response.get('rows', [])
        print('final_result', final_result)

        for item in final_result:
            item['description'] = remove_first_two_dollar_amounts(item['description'])

        output = {
            'format': 'table',
            "title": f"{year} {TABLE_TO_FIND}",
            'source': [nova.page.url],
            'data': {
                "cols": [
                    {
                        "attribute": "description",
                        "header": ""
                    },
                    {
                        "attribute": "value",
                        "header": "2024"
                    }
                ],
                'rows': final_result
            }
        }
        return output
    except Exception as e:
        print(f"Error during act: {e}")
        return None

def scroll_based_on_instruction(nova, instruction, retry=1):
    print('scroll_based_on_instruction', instruction, retry)

    if retry > 30:
        return False
    else:
        try:
            nova.act(instruction)
            return True
        except ActExceededMaxStepsError as error:
            print(f"Allowing continuation on retry to allow for long documents that need a lot of scrolling - {retry}", error)
            return scroll_based_on_instruction(nova, instruction, retry + 1)
        except ActError as error:
            # NOTE - you may not want to allow continuation here, it will depend on your use-case
            print(f"Allowing continuation on Act Error (useful for when service may be having issues) - {retry}", error)
            return scroll_based_on_instruction(nova, instruction, retry + 1)
        except Exception as e:
            print(f"Error during act: {e}")
            raise

def write_output_log(nova, action, output, type='output', logs_directory='./'):
    parent = 'final'
    if nova is not None and nova.get_session_id() is not None:
        parent = nova.get_session_id()
    else:
        os.makedirs(f'{logs_directory}/{parent}', exist_ok=True)
    current_time = pd.Timestamp.now()
    # get timestamp in seconds
    current_timestamp = int(current_time.timestamp())

    action = {
        "type": type,
        "parent_id": parent,
        "timestamp": current_timestamp,
        "action": 'Output',
        "output": output,
        "task": action,
        "active_url": "",
        "program_body": "",
        "id": "0",
        "workflow_run_id": "0",
        "workflow_event_id": "0",
        "screenshot": "0",
        "start_time": current_timestamp
    }

    #write out new log file
    with(open(f'{logs_directory}/{parent}/output_{current_time}.json', 'w')) as f:
        f.write(json.dumps(action, indent=4, default=str))


def main(headless ,logs_directory, record_video):
    navigate_sec(headless ,logs_directory, record_video)

if __name__ == "__main__":
    seclogs = "./logs/seclogs/" + pd.Timestamp.now().strftime("%Y-%m-%d_%H-%M-%S")
    os.makedirs(seclogs, exist_ok=True)
    main(headless=False, logs_directory=seclogs, record_video=True)