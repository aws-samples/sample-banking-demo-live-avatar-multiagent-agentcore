# Copyright 2025 Amazon Inc

# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Set up a user_data_dir for logged in websites.

See README for more details.

Usage:
python -m nova_act.samples.setup_chrome_user_data_dir --user_data_dir <directory>
"""

#https://github.com/aws/nova-act/blob/main/src/nova_act/samples/setup_chrome_user_data_dir.py

import os
from getpass import getpass

# import fire

from nova_act import NovaAct
from nova_act.util.jsonschema import BOOL_SCHEMA



def main(user_data_dir: str) -> None:
    os.makedirs(user_data_dir, exist_ok=True)
    print(f"User data dir: {user_data_dir=}")

    with NovaAct(starting_page="http://localhost:3000/", user_data_dir=user_data_dir, clone_user_data_dir=False, ignore_https_errors=True) as nova:
        login = nova.act('Is the site asking for login?', schema=BOOL_SCHEMA)
        if login.parsed_response:
            print("Logging in...")

            """
            Option 1 - enter some of the info and then use playwright to capture the rest.
            """
            nova.act("enter username janedoe and click on the password field")
            # Collect the password from the command line and enter it via playwright. (Does not get sent over the network.)
            nova.page.keyboard.type(getpass())
            # Now that username and password are filled in, ask NovaAct to proceed.
            nova.act("sign in")

            """
            Option 2 - wait for the user to login and then capture the user data dir. 
            This is useful for federated log-ins that require MFA.
            """
            input("Log into your websites, then press enter...")


        input("Logout, then press enter...")

    print(f"User data dir saved to {user_data_dir=}")


if __name__ == "__main__":
#     fire.Fire(main)
    main(user_data_dir='/tmp/auth-user-data-dir')