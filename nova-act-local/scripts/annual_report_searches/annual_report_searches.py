import concurrent.futures
import os
import sys
from nova_act import NovaAct
from nova_act.util.jsonschema import BOOL_SCHEMA
from pydantic import BaseModel
import re


sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from utils.utils import write_output_log, save_final_output, log_authenticated_session, log_relationship, create_log_dirs, log_in, scroll_based_on_instruction  # type: ignore


# Website URLs for financial data sources
SEC_SITE = 'https://www.sec.gov/'  # SEC (Securities and Exchange Commission) website
AMAZON_IR_SITE = 'https://ir.aboutamazon.com/overview/default.aspx'  # Amazon Investor Relations site
MOCK_VDR_SITE = 'http://localhost:3001/virtual-data-room'  # Local virtual data room for testing
USER_DATA= "/tmp/auth-user-data"  # Temporary storage for user authentication data

# Configuration for report extraction
REPORTS_TO_GET = ['2024', '2023']  # Years of annual reports to retrieve
TABLE_TO_FIND = 'Consolidated Statements of Comprehensive Income (Loss)'  # Specific financial table to extract

# Pydantic models for structured data validation and parsing
class Pages(BaseModel):
    """Model for page count information"""
    pages: int

class TableItem(BaseModel):
    """Model for individual table row with description and value"""
    description: str  # Row label/description
    value: str        # Corresponding financial value

class Table(BaseModel):
    """Model for complete financial table containing multiple rows"""
    rows: list[TableItem]

def navigate_amazon_ir(headless, logs_directory, record_video, parent_session=""):
    """Navigate Amazon Investor Relations site and extract annual reports concurrently
    
    Args:
        headless (bool): Run browser in headless mode
        logs_directory (str): Directory to store execution logs
        record_video (bool): Whether to record video of browser actions
        parent_session (str): The nova session that spawned this one in the workflow (if any)
    """
    # Navigate to Amazon IR site and get to the annual reports page
    with NovaAct(
            starting_page=AMAZON_IR_SITE,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            preview={"playwright_actuation": True}
    ) as nova:
        current_nova_id = nova.get_session_id()
        log_relationship(logs_directory, parent_session, current_nova_id)
        # Click on annual reports link to access the reports listing page
        # nova.act("Click on the 'Annual reports, proxies and shareholder letters' text on the left hand side to open the annual reports page")
        nova.act("Click on the word 'Annual' on the left hand side to open the annual reports page")

        reports_page = nova.page.url  # Store the reports page URL for concurrent processing

    # Process multiple years concurrently for better performance
    result_array = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        # Submit tasks for each report year to be processed in parallel
        future_to_report = {executor.submit(get_report_for_year_amazon_ir, reports_page, year, headless, logs_directory, record_video, current_nova_id): year for year in REPORTS_TO_GET}
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(future_to_report):
            url = future_to_report[future]
            try:
                data = future.result()
                result_array.append(data)
                print('THREAD', data)  # Log successful extraction
            except Exception as exc:
                print('%r generated an exception: %s' % (url, exc))  # Log any errors
    
    # Compile final results and write to log
    print('result_array', result_array)
    final_output = {
        "format": "array",
        "data": result_array
    }
    write_output_log(None, f"Amazon IR results", final_output, "output", logs_directory=logs_directory)
    return final_output


def get_report_for_year_amazon_ir(report_page, report_year, headless, logs_directory, record_video, parent_session=""):
    """Extract financial data from a specific year's Amazon annual report
    
    Args:
        report_page (str): URL of the reports listing page
        report_year (str): Year of the report to extract (e.g., '2024')
        headless (bool): Run browser in headless mode
        logs_directory (str): Directory to store execution logs
        record_video (bool): Whether to record video of browser actions
        
    Returns:
        dict: Extracted financial table data for the specified year
    """
    print(f"Getting {report_year} report from {report_page}")
    with NovaAct(
            starting_page=report_page,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            preview={"playwright_actuation": True}
    ) as nova:
        log_relationship(logs_directory, parent_session, nova.get_session_id())
        # Calculate the section year (reports are grouped by the year after publication)
        report_year_inc = int(report_year) + 1
        try:
            # Navigate to the specific annual report
            nova.act(f'Expand the {report_year_inc} section by clicking on it')
            nova.act(f'Open the {report_year} Annual Report by clicking on the link to it in the now expanded {report_year_inc} section')

            # Extract the financial table data from the opened report
            report_details = get_table_details_by_scrolling(nova, report_year)
            write_output_log(nova, f"{TABLE_TO_FIND} results", report_details, logs_directory=logs_directory)
            return report_details
        except Exception as e:
            print("Error getting report for Amazon IR", e)
            return {
                'format': 'string',
                'data':  f"Error getting {report_year} {TABLE_TO_FIND} from Amazon IR",
                'source': [nova.page.url]
            }

def navigate_sec(headless, logs_directory, record_video, parent_session=""):
    """Navigate SEC website and extract Amazon's annual reports concurrently
    
    Args:
        headless (bool): Run browser in headless mode
        logs_directory (str): Directory to store execution logs
        record_video (bool): Whether to record video of browser actions
        parent_session (str):
    """
    # Navigate to SEC website and search for Amazon filings
    with NovaAct(
            starting_page=SEC_SITE,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            preview={"playwright_actuation": True}
    ) as nova:
        current_nova_id = nova.get_session_id()
        log_relationship(logs_directory, parent_session, current_nova_id)
        # Search for Amazon on the SEC website
        nova.act("Find the search box and search for Amazon")
        # Navigate to EDGAR filings page (handle potential feedback popup)
        nova.act("Click on the link for Filings on EDGAR to navigate to it. If you get a pop-up ask for feedback close it.")

        reports_page = nova.page.url  # Store URL for concurrent processing
        print('current url', reports_page)

    # Process multiple years concurrently for better performance
    result_array = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        # Submit tasks for each report year to be processed in parallel
        future_to_report = {executor.submit(get_report_for_year, reports_page, year, headless, logs_directory, record_video, current_nova_id): year for year in REPORTS_TO_GET}
        
        # Collect results as they complete
        for future in concurrent.futures.as_completed(future_to_report):
            url = future_to_report[future]
            try:
                data = future.result()
                result_array.append(data)
                print('THREAD', data)  # Log successful extraction
            except Exception as exc:
                print('%r generated an exception: %s' % (url, exc))  # Log any errors
    
    # Compile final results and write to log
    print('result_array', result_array)
    final_output = {
        "format": "array",
        "data": result_array
    }
    write_output_log(None, f"SEC site results", final_output, 'output', logs_directory=logs_directory)
    return final_output


def get_report_for_year(report_page, report_year, headless, logs_directory, record_video, parent_session=""):
    """Extract financial data from a specific year's SEC 10-K filing
    
    Args:
        report_page (str): URL of the SEC filings page
        report_year (str): Year of the report to extract (e.g., '2024')
        headless (bool): Run browser in headless mode
        logs_directory (str): Directory to store execution logs
        record_video (bool): Whether to record video of browser actions
        
    Returns:
        dict: Extracted financial table data for the specified year
    """
    current_nova_id = ""
    with NovaAct(
            starting_page=report_page,
            headless=headless,
            logs_directory=logs_directory,
            record_video=record_video,
            preview={"playwright_actuation": True}
    ) as nova:
        current_nova_id = nova.get_session_id()
        log_relationship(logs_directory, parent_session, current_nova_id)
        # Calculate filing year (10-K reports are typically filed in the year after the reporting period)
        report_year_inc = int(report_year) + 1
        
        # Navigate to the 10-K filings section
        nova.act("Expand the 10-K (annual reports) and 10-Q (quarterly reports) section")
        nova.act("Click the 'View all 10-Ks and 10-Qs' button")

        try:
            # Adjust search filters and find the specific 10-K report
            nova.act('Unselect the checkbox that says "Reporting date"')
            # Click on the 10-K report for the specified year
            nova.act(f"Click on the link in the 'Form description' column of the row in the filings table that has a 'Form type' of '10K', and a 'Filing date' that starts with'{report_year_inc}'", timeout=60)

        except Exception as e:
            current_page = nova.page.url
            print(f"Error during act in get_report_for_year on {current_page}: {e}")

            # Handle SEC's interactive document viewer URL format
            if '/ix?doc=' in current_page:
                print(f"Removing interactive viewer prefix to get direct document URL continue")
                # Remove interactive viewer prefix to get direct document URL
                new_url = current_page.replace('/ix?doc=', '')
                nova.go_to_url(new_url)
            else:
                raise e

        # Extract the financial table data from the opened 10-K report
        report_details = get_table_details_by_scrolling(nova, report_year)
        write_output_log(nova, f"{TABLE_TO_FIND} results", report_details, 'output', logs_directory=logs_directory)

        return report_details


def remove_first_two_dollar_amounts(text):
    """Clean up table descriptions by removing extraneous dollar amounts
    
    Financial table descriptions sometimes contain multiple dollar amounts that clutter
    the description. This function removes the first two dollar amounts while preserving
    the main description text.
    
    Args:
        text (str): Original text containing dollar amounts
        
    Returns:
        str: Cleaned text with first two dollar amounts removed
    """
    # Regular expression to match dollar amounts (e.g., $1,234.56)
    dollar_pattern = r'\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?'
    matches = list(re.finditer(dollar_pattern, text))

    # Only process if there are at least 3 dollar amounts (keep the last one)
    if len(matches) >= 3:
        # Remove the first two matches from the text
        # Work backwards to avoid index shifting issues
        for match in reversed(matches[:2]):
            start = match.start()
            end = match.end()

            # Clean up preceding punctuation/whitespace
            if start > 0 and text[start-2:start] == ', ':
                start -= 2  # Remove comma and space
            elif start > 0 and text[start-1] == ' ':
                start -= 1  # Remove just the space
            
            # Remove the dollar amount and any preceding punctuation
            text = text[:start] + text[end:]
    return text

def get_table_details_by_scrolling(nova, year):
    """Extract financial table data by scrolling to find the target table
    
    Args:
        nova: NovaAct instance for browser automation
        year (str): Year of the financial data to extract
        
    Returns:
        dict: Structured financial table data or None if extraction fails
    """
    try:
        # Scroll to locate the target financial table
        instruction = f"Scroll down until you see the {TABLE_TO_FIND} table with dollar values for income and loss showing onscreen"
        scroll_based_on_instruction(nova, instruction, 1, True)
        
        # Extract table data using structured schema
        result = nova.act(f"Capture the {year} values from the table as a list of key value pairs. The description is on the left and the value is in the {year} column. When generating JSON, escape all special characters in string values: double quotes as \", backslashes as \\, newlines as \n, tabs as \t, etc. Validate that the output is valid JSON before responding.", schema=Table.model_json_schema())
        print(result, result.parsed_response)
        if not result.parsed_response:
            print('invalid JSON format, trying one more time')
            result = nova.act(f"Capture the {year} values from the table as a list of key value pairs. The description is on the left and the value is in the {year} column. When generating JSON, escape all special characters in string values: double quotes as \", backslashes as \\, newlines as \n, tabs as \t, etc. Validate that the output is valid JSON before responding.", schema=Table.model_json_schema())
        final_result = result.parsed_response.get('rows', [])
        print('final_result', final_result)

        # Clean up descriptions by removing extraneous dollar amounts
        for item in final_result:
            item['description'] = remove_first_two_dollar_amounts(item['description'])

        # Structure the output in a standardized format
        output = {
            'format': 'table',
            "title": f"{year} {TABLE_TO_FIND}",
            'source': [nova.page.url],  # Track source URL for reference
            'data': {
                "cols": [
                    {
                        "attribute": "description",
                        "header": ""  # Description column header
                    },
                    {
                        "attribute": "value",
                        "header": "2024"  # Value column header (should be dynamic based on year)
                    }
                ],
                'rows': final_result  # Cleaned table rows
            }
        }
        return output
    except Exception as e:
        print(f"Error during act in get_table_details_by_scrolling: {e}")
        return {
            'format': 'string',
            'data':  f"Error getting {year} {TABLE_TO_FIND}",
            'source': [nova.page.url]
        }


def log_in_to_vdr(headless ,logs_directory, record_video, user_data_dir=USER_DATA, clone_user_data_dir=False, parent_session=""):
    os.makedirs(USER_DATA, exist_ok=True)
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
        current_nova_id = nova.get_session_id()
        log_relationship(logs_directory, 'start', current_nova_id)
        login = nova.act("Is the site asking for login?", schema=BOOL_SCHEMA)
        if login.parsed_response:
            log_in(nova, logs_directory)

    write_output_log(None, 'User session saved', {}, 'user-input', logs_directory=logs_directory, parent='user-session')
    return current_nova_id




def navigate_vdr(headless ,logs_directory, record_video, user_data_dir=USER_DATA, clone_user_data_dir=False, parent=""):
    result_array = []

    # We can't actually run multiple authenticated sessions at once since it will try to reuse the same session
    result_array = []
    for year in REPORTS_TO_GET:
        results = get_report_for_year_mock_vdr(MOCK_VDR_SITE, year, headless, logs_directory, record_video, parent)
        print(f"VDR report results for {year}: {results}")
        result_array.append(results)

    print('final result_array', result_array)
    final_output = {
        "format": "array",
        "data": result_array
    }
    write_output_log(None, 'VDR results', final_output, 'output', logs_directory=logs_directory, parent='final')
    return final_output


def get_report_for_year_mock_vdr(report_page, report_year, headless, logs_directory, record_video, parent_session=""):
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
        log_authenticated_session(nova, logs_directory)
        log_relationship(logs_directory, parent_session, nova.get_session_id())

        nova.act(f'Wait for the document table to load')
        nova.act(f'Click on {report_year} Amazon Annual Report listed in the table and wait for it to open.')
        report_details = get_table_details_by_scrolling(nova, report_year)
        write_output_log(nova, f"{TABLE_TO_FIND} results", report_details, logs_directory=logs_directory)

        return report_details

def main(headless ,logs_directory, record_video):

    # First log into the site that needs authentication to create an authenticated session
    session_id = log_in_to_vdr(False ,logs_directory, record_video, USER_DATA, False)

    results_array = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_sites = {
            executor.submit(navigate_sec, headless, logs_directory, record_video, session_id),
            executor.submit(navigate_amazon_ir, headless, logs_directory, record_video, session_id),
            executor.submit(navigate_vdr, headless, logs_directory, record_video, USER_DATA, False, session_id)
        }

        for future in concurrent.futures.as_completed(future_sites):
            try:
                data = future.result()
                print('MAIN THREADS', data)
                results_array.append(data)
            except Exception as e:
                print(e)

        final_output = {
            "format": "array",
            "data": results_array
        }
        write_output_log(None, 'Final output', final_output, 'final-output', logs_directory=logs_directory, parent='final')
        save_final_output(final_output, logs_directory)

    print('Site navigation complete')

if __name__ == "__main__":
    report_logs = create_log_dirs("report-logs", "search")
    print('LOGS DIRECTORY', report_logs)
    main(headless=True, logs_directory=report_logs, record_video=True)
