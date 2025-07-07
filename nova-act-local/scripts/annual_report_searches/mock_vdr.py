import concurrent.futures
import os
import pandas as pd
from nova_act import NovaAct
from nova_act.types.act_errors import ActExceededMaxStepsError, ActError
from nova_act.util.jsonschema import BOOL_SCHEMA
from pydantic import BaseModel
import json
import re
from getpass import getpass

SEC_SITE = 'https://www.sec.gov/'
AMAZON_IR_SITE = 'https://ir.aboutamazon.com/overview/default.aspx'
MOCK_VDR_SITE = 'http://localhost:3001/virtual-data-room'

USER_DATA= "/tmp/auth-user-data-dir3"

REPORTS_TO_GET = ['2024', '2023']
TABLE_TO_FIND = 'Consolidated Statements of Comprehensive Income (Loss)'

class Pages(BaseModel):
    pages: int

class TableItem(BaseModel):
    description: str
    value: str

class Table(BaseModel):
    rows: list[TableItem]



def log_in(nova, logs_directory, federate=False):
    """
    Wait for the user to log in and then capture the user data dir.
    This is useful for federated log-ins that require MFA.
    """
    # print("Wait for federate")
    # input("Log into your websites, then press enter...")

    """
    Enter some of the info and then use playwright to capture the rest.
    """
    nova.act("enter username janedoe and click on the password field")
    # Collect the password from the command line and enter it via playwright. (Does not get sent over the network.)
    nova.page.keyboard.type(getpass())
    write_output_log(nova, 'Manual User Input', {}, 'user-input', logs_directory=logs_directory)
    # Now that username and password are filled in, ask NovaAct to proceed.
    nova.act("Click on the sign in button")


def log_in_to_vdr(headless ,logs_directory, record_video, user_data_dir=USER_DATA, clone_user_data_dir=False):
    with NovaAct(
            starting_page=MOCK_VDR_SITE + '/login',
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            user_data_dir=user_data_dir,
            clone_user_data_dir=clone_user_data_dir,
            ignore_https_errors=True,
            preview={"playwright_actuation": True}
    ) as nova:
        login = nova.act("Is the site asking for login?", schema=BOOL_SCHEMA)
        if login.parsed_response:
            log_in(nova, logs_directory)

    write_output_log(None, 'User session saved', {}, 'user-input', logs_directory=logs_directory, parent='user-session')

    result_array = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        # Start the load operations and mark each future with its URL
        future_to_report = {executor.submit(get_report_for_year_mock_vdr, MOCK_VDR_SITE, year, headless, logs_directory, record_video): year for year in ['2024']}
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

    write_output_log(None, 'User session saved', {}, 'user-input', logs_directory=logs_directory, parent='final')


def get_report_for_year_mock_vdr(report_page, report_year, headless, logs_directory, record_video):
    print('report_page', report_page)
    print('report_year', report_year)
    with NovaAct(
            starting_page=report_page,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            user_data_dir=USER_DATA,
            clone_user_data_dir=False,
            ignore_https_errors=True,
            preview={"playwright_actuation": True}
    ) as nova:
        nova.act('Wait for the document table to load')
        nova.act(f'Click on {report_year} Amazon Annual Report listed in the table and wait for it to open.')
        report_details = get_table_details_by_scrolling(nova, report_year)
        write_output_log(nova, f"{TABLE_TO_FIND} results", report_details, logs_directory=logs_directory)

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


def get_table_details_by_page(nova, year, starting_page=1):
    # nova.act("Close the sidebar by clicking on the hamburger menu at the top left of the page")
    pages = nova.act("Get the number of pages in the document by looking in the bar just above the pdf document", schema=Pages.model_json_schema())
    print('pages', pages.parsed_response)
    page = starting_page
    retries = 0

    final_result = []
    while page < pages.parsed_response.get('pages', 100):
        try:
            # nova.act(f"Set the page number to {page} in the bar at the top of the page and click enter", max_steps=3)
            nova.act(f"Above the pdf document there is a indicator of the current page and total pages separated by a /. Click into the current page box and enter {page} and click enter to move the document to that page.", max_steps=3)
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

def write_output_log(nova, action, output, type='output', logs_directory='./', parent='final'):

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

    log_in_to_vdr(headless ,logs_directory, record_video)

    #get_report_for_year_mock_vdr(MOCK_VDR_SITE, 2023, headless ,logs_directory, record_video)
    # with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
    #
    #     future_sites = {
    #         executor.submit(navigate_sec, headless, logs_directory, record_video),
    #         executor.submit(navigate_amazon_ir, headless, logs_directory, record_video),
    #     }
    #
    #     for future in concurrent.futures.as_completed(future_sites):
    #         try:
    #             data = future.result()
    #             print('THREAD', data)
    #         except Exception as e:
    #             print(e)

    print('Site navigation complete')

if __name__ == "__main__":
    reportlogs = "./logs/vdrreportlogs/" + pd.Timestamp.now().strftime("%Y-%m-%d_%H-%M-%S")
    os.makedirs(reportlogs, exist_ok=True)
    os.makedirs(USER_DATA, exist_ok=True)
    main(headless=False, logs_directory=reportlogs, record_video=True)