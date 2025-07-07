import concurrent.futures
import os
import pandas as pd
from nova_act import NovaAct
from nova_act.types.act_errors import ActExceededMaxStepsError, ActError
from nova_act.util.jsonschema import BOOL_SCHEMA
from pydantic import BaseModel
import json

AMAZON_IR_SITE = 'https://ir.aboutamazon.com/overview/default.aspx'
DEFAULT_ACT_TIMEOUT = 60
REPORTS_TO_GET = ['2024', '2023']
TABLE_TO_FIND = 'Consolidated Statements of Comprehensive Income (Loss)'

class Pages(BaseModel):
    pages: int

class TableItem(BaseModel):
    description: str
    value: str

class Table(BaseModel):
    rows: list[TableItem]


def navigate_amazon_ir(headless ,logs_directory, record_video):
    # reports_page = ''

    with NovaAct(
            starting_page=AMAZON_IR_SITE,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            # preview={"playwright_actuation": True}
    ) as nova:
        nova.act("Click on the 'Annual reports, proxies and shareholder letters' text on the left hand side to open the annual reports page")
        # nova.act('Go to the Annual Reports page by clicking on the Annual reports, proxies and shareholder letters link on the left hand side')
        reports_page = nova.page.url

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
    write_output_log(None, f"Final results", final_output, logs_directory=logs_directory)


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
        nova.act(f'Expand the {report_year_inc} section by clicking on it')
        nova.act(f'Open the {report_year} Annual Report by clicking on the link to it in the now expanded {report_year_inc} section')

        report_details = get_table_details_by_scrolling(nova, report_year)
        write_output_log(nova, f"{TABLE_TO_FIND} results", report_details, logs_directory=logs_directory)

        return report_details



def get_table_details_by_page(nova, year, starting_page=1):
    nova.act("Close the sidebar by clicking on the hamburger menu at the top left of the page")
    pages = nova.act("Get the number of pages in the document by looking in the top bar", schema=Pages.model_json_schema())
    print('pages', pages.parsed_response)
    page = starting_page
    retries = 0

    final_result = []
    while page < pages.parsed_response.get('pages', 100):
        try:
            # nova.act(f"Set the page number to {page} in the bar at the top of the page and click enter", max_steps=3)
            nova.act(f"In the middle of the top of the page there is a indicator of the current page and total pages separated by a /. Click into the current page box and enter {page} and click enter to move the document to that page.", max_steps=3)
            # Only move the page forward if it was successful, if it fails let it retry the page
            page += 1

            table = nova.act(f"Is the {TABLE_TO_FIND} table with dollar values for income and loss showing onscreen?", schema=BOOL_SCHEMA)
            if not table.parsed_response:
                continue
            else:
                result = nova.act(f"Capture the {year} values from the table as a list of key value pairs. The description is on the left and the value is in the {year} column", schema=Table.model_json_schema())
                print(result.parsed_response)
                final_result = result.parsed_response.get('rows', [])
                break
        except ActExceededMaxStepsError as error:
            print(f"Allowing continuation on retry {retries}", error)
            retries += 1
            if retries > 300:
                print('ok, guess that is enough retries')
                raise
            continue
        except ActError as error:
            print(f"Allowing continuation on Act Error because it is often failing on things that can be retried {retries}", error)
            retries += 1
            if retries > 300:
                print('ok, guess that is enough retries')
                raise
            continue
        except Exception as e:
            print(f"Error during act: {e}")
            raise
    print('final_result', final_result)
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


def get_table_details_by_scrolling(nova, year):
    try:
        instruction = f"Scroll down until you see the {TABLE_TO_FIND} table with dollar values for income and loss showing onscreen"
        scroll_based_on_instruction(nova, instruction, 1)
        result = nova.act(f"Capture the {year} values from the table as a list of key value pairs. The description is on the left and the value is in the {year} column", schema=Table.model_json_schema())
        print(result.parsed_response)
        final_result = result.parsed_response.get('rows', [])
        print('final_result', final_result)
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

    if retry > 300:
        return False
    else:
        try:
            nova.act(instruction)
            return True
        except ActExceededMaxStepsError as error:
            print(f"Allowing continuation on retry to allow for long documents that need a lot of scrolling {retry}", error)
            return scroll_based_on_instruction(nova, instruction, retry + 1)
        except ActError as error:
            print(f"Allowing continuation on Act Error because it keeps erroring for no good reason {retry}", error)
            return scroll_based_on_instruction(nova, instruction, retry + 1)
        except Exception as e:
            print(f"Error during act: {e}")
            raise

def write_output_log(nova, action, output, logs_directory='./'):
    current_timestamp = pd.Timestamp.now()
    parent = 'final'
    if nova is not None and nova.get_session_id() is not None:
        parent = nova.get_session_id()
    else:
        os.makedirs(f'{logs_directory}/{parent}', exist_ok=True)

    output_log = {
        'parent': parent,
        'start_time':current_timestamp,
        'end_time': current_timestamp,
        'video': '',
        'video_path': '',
        'action': action,
        'video_duration': 0,
        'number_actions': 1,
        'actions': [
            {
                'timestamp': current_timestamp,
                'start_time': current_timestamp,
                'action': 'Output',
                'output': output,
                'task': '',
                'active_url': '',
                'program_body': '',
                'id': 'end',
                'workflow_run_id': 'end',
                'workflow_event_id': 'end',
                'screenshot': '',
                'screenshot_path': ''
            }
        ]
    }
    #write out new log file
    with(open(f'{logs_directory}/{parent}/output-{current_timestamp}.json', 'w')) as f:
        f.write(json.dumps(output_log, indent=4, default=str))


def main(headless ,logs_directory, record_video):
    navigate_amazon_ir(headless ,logs_directory, record_video)

if __name__ == "__main__":
    #logs directory should be logs with current date-time
    logs = "./logs/amzonir/" + pd.Timestamp.now().strftime("%Y-%m-%d_%H-%M-%S")
    os.makedirs(logs, exist_ok=True)
    navigate_amazon_ir(headless=False, logs_directory=logs, record_video=True)