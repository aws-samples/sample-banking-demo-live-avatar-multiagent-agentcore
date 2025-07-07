import os
import json
from datetime import datetime
from getpass import getpass, getuser

from nova_act.types.act_errors import ActExceededMaxStepsError, ActAgentError
from typing import Union, List, Dict, Optional
from enum import Enum

class Format(Enum):
    STRING = "STRING"
    ARRAY = "ARRAY"
    TABLE = "TABLE"

class Column:
    def __init__(self, attribute: str, header: str):
        self.attribute = attribute
        self.header = header

class DataInterface:
    def __init__(self, format: Format, source: List[str], data: Union[str, List, Dict], title: Optional[str] = None):
        self.format = format
        self.source = source
        self.title = title
        self.data = data

    @classmethod
    def create_string(cls, source: Union[str, List[str]], data: str, title: Optional[str] = None):
        source_array = [source] if isinstance(source, str) else source
        return cls(Format.STRING, source_array, data, title)

    @classmethod
    def create_array(cls, source: Union[str, List[str]], data: List['DataInterface'], title: Optional[str] = None):
        source_array = [source] if isinstance(source, str) else source
        return cls(Format.ARRAY, source_array, data, title)

    @classmethod
    def create_table(cls, source: Union[str, List[str]], cols: List[Column], rows: List[Dict], title: Optional[str] = None):
        source_array = [source] if isinstance(source, str) else source
        data = {"cols": cols, "rows": rows}
        return cls(Format.TABLE, source_array, data, title)
    
    def to_dict(self):
        result = {
            "format": self.format.value,
            "source": self.source
        }
        if self.title:
            result["title"] = self.title
            
        if self.format == Format.ARRAY and isinstance(self.data, list):
            result["data"] = [item.to_dict() if isinstance(item, DataInterface) else item for item in self.data]
        elif self.format == Format.TABLE and isinstance(self.data, dict):
            result["data"] = {
                "cols": [{"attribute": col.attribute, "header": col.header} for col in self.data["cols"]],
                "rows": self.data["rows"]
            }
        else:
            result["data"] = self.data
            
        return result


RELATIONSHIP_DIR = "relationships"
FINAL_OUTPUT_DIR = "final"

def create_log_dirs(parent_dir, log_folder_name='logs'):
    # Create the parent directory if it doesn't exist
    if not os.path.exists(parent_dir):
        os.makedirs(parent_dir)

    current_date = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    # Create the log folder if it doesn't exist
    log_folder_path = os.path.join(parent_dir, log_folder_name, current_date)
    if not os.path.exists(log_folder_path):
        os.makedirs(log_folder_path)

    os.makedirs(f"{log_folder_path}/{FINAL_OUTPUT_DIR}")
    os.makedirs(f"{log_folder_path}/{RELATIONSHIP_DIR}")

    return log_folder_path

def create_temp_log_dirs(script_name):
    """
    Create log directories in temp-nova-log-dir at project root
    
    Args:
        script_name: Name of the script (middle folder)
    
    Returns:
        Path to the created log directory
    """
    # Find project root by going up from utils directory
    utils_dir = os.path.dirname(os.path.abspath(__file__))
    scripts_dir = os.path.dirname(utils_dir)
    nova_act_local_dir = os.path.dirname(scripts_dir)
    project_root = os.path.dirname(nova_act_local_dir)
    current_date = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    temp_log_dir = os.path.join(project_root, "temp-nova-log-dir")
    return create_log_dirs(temp_log_dir, script_name)


def save_final_output(data, logs_directory):
    with open(f'{logs_directory}/task-output.json', 'w') as f:
        f.write(json.dumps(data, indent=4, default=str))

def log_authenticated_session(nova, logs_directory):
    session_id = nova.get_session_id()
    with open(f'{logs_directory}/{session_id}/authenticated.txt', 'w') as f:
        f.write('')

def write_output_log(nova, action, output, type='output', logs_directory='./', parent=FINAL_OUTPUT_DIR):
    """
    Create manual output logs alongside the Nova Act logs to record events from your scripts

    Args:
        nova: NovaAct instance (can be None)
        action (str): Description of the action being logged
        output: Data to be logged
        type (str): Type of log entry (default: 'output')
        logs_directory (str): Directory to store logs (default: './')
        parent (str): Parent identifier for log organization (default: 'final')
    """
    if nova is not None and nova.get_session_id() is not None:
        parent = nova.get_session_id()
    else:
        os.makedirs(f'{logs_directory}/{parent}', exist_ok=True)

    current_time = datetime.now()
    current_timestamp = int(current_time.timestamp())

    log_entry = {
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

    # Write out new log file
    file_path = f'{logs_directory}/{parent}/output_{current_time}.json'
    with open(file_path, 'w') as f:
        f.write(json.dumps(log_entry, indent=4, default=str))

    return file_path

def log_relationship(logs_directory, parent_session_id, child_session_id):
    print('creating relationship', parent_session_id, child_session_id)
    if parent_session_id is "":
        parent_session_id = "start"
    if not parent_session_id or not child_session_id:
        print('Unable to create relationship, missing parent or child id')
    with open(f'{logs_directory}/{RELATIONSHIP_DIR}/{parent_session_id}__{child_session_id}.txt', 'w') as f:
        f.write('')


def log_in(nova, logs_directory, federate=False):

    if federate:
        """
        Pause script to allow user to log in.
        This is useful for federated log-ins that require MFA.
        This will require the user has a way to interact with the front end
        """
        print("Wait for federate")
        input("Log into your websites, then press enter...")

    else:
        """
        Use playwright to capture the username and password, and nova to navigate between fields and log-in.
        Allows headless running of scripts
        """
        nova.act(f"Click on the username field")
        nova.page.keyboard.type(getuser())
        nova.act(f"Click on the password field")
        # Collect the password from the command line and enter it via playwright. (Does not get sent over the network.)
        nova.page.keyboard.type(getpass())
        write_output_log(nova, 'Manual User Input', {}, 'user-input', logs_directory=logs_directory)
        # Now that username and password are filled in, ask NovaAct to proceed.
        nova.act("Click on the sign in button")

def scroll_based_on_instruction(nova, instruction, retry_number=1, retryActAgentErrors=False, maxRetries=10):
    """Recursively scroll through a page based on instruction with retry logic

    This function handles long documents that may require extensive scrolling to find
    the target content. It implements a retry mechanism to handle cases where the
    initial scroll attempt doesn't reach the desired content.

    Args:
        nova: NovaAct instance for browser automation
        instruction (str): Scrolling instruction to execute
        retry (int): Current retry attempt number

    Returns:
        bool: True if scrolling succeeded, False if max retries exceeded
    """
    print('scroll_based_on_instruction', instruction, retry_number )

    # Prevent infinite recursion by limiting retry attempts
    if retry_number > maxRetries:
        return False
    else:
        try:
            nova.act(instruction)
            return True
        except ActExceededMaxStepsError as error:
            # Allow continuation for long documents that require extensive scrolling
            print(f"Allowing continuation on retry to allow for long documents that need a lot of scrolling - {retry_number}", error)
            return scroll_based_on_instruction(nova, instruction, retry_number + 1)
        except ActAgentError as error:
            print("Error during act:", error)
            # For larger or longer running scripts we may want to allow retries on general errors too, as often these can work on a retry
            if retryActAgentErrors:
                print(f"Retrying on ActAgentError - {retry_number}", error)
                return scroll_based_on_instruction(nova, instruction, retry_number + 1)
            else:
                raise error
        except Exception as e:
            print(f"Error during act: {e}")
            raise
