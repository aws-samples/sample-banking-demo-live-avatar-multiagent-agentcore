#!/usr/bin/env python3
"""
AWS Summit New York Registration Script - Detailed Form Automation
This script automates the complete registration process with specific form data
and cancels at the end for testing purposes.

Prerequisites:
- Install Nova Act: pip install nova-act
- Set up your Nova Act API key: export NOVA_ACT_API_KEY="your_api_key"
"""

import os
import sys
from nova_act import NovaAct, BOOL_SCHEMA
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from utils.utils import create_temp_log_dirs, create_log_dirs, write_output_log, save_final_output, log_relationship, DataInterface, Column # type: ignore

# Sample data for multiple people
PEOPLE_DATA = [
    {
        "first_name": "Alejandro",
        "last_name": "Rosalez",
        "email": "alejandro_rosalez@example.org",
        "phone": "909-867-5309",
        "city": "Los Angeles",
        "state": "CA",
        "postal_code": "90001",
        "job_title": "SDE",
        "company": "ExampleCorp"
    },
    {
        "first_name": "Jane",
        "last_name": "Doe",
        "email": "jane_doe@example.org",
        "phone": "555-123-4567",
        "city": "San Francisco",
        "state": "CA",
        "postal_code": "94102",
        "job_title": "DevOps Engineer",
        "company": "ExampleCorp"
    },
    {
        "first_name": "Nikhil",
        "last_name": "Jayashankar",
        "email": "nikhil_jayashankar@example.org",
        "phone": "212-555-9876",
        "city": "New York",
        "state": "NY",
        "postal_code": "10001",
        "job_title": "CTO",
        "company": "ExampleCorp"
    }
]

def register_person(person_data, logs_dir, thread_id, parent_id):
    """
    Register a single person with their specific data
    """
    person_name = f"{person_data['first_name']} {person_data['last_name']}"
    print(f"🚀 [Thread {thread_id}] Starting registration for {person_name}...")
    
    try:
        with NovaAct(starting_page="https://aws.amazon.com/events/summits/new-york",
                     headless=True,
                     record_video=True,
                     logs_directory=logs_dir) as nova:
            current_nova_id = nova.get_session_id()
            log_relationship(logs_dir, parent_id, current_nova_id)

            print(f"\n🔍 [Thread {thread_id}] Opening registration for {person_name}...")
            nova.act("Look for and click the 'Register' or 'Register Now' button")
            nova.act("If a cookies banner is visible, accept all cookies")
            
            print(f"\n👤 [Thread {thread_id}] Filling basic information for {person_name}...")
            nova.act(f"Enter '{person_data['first_name']}' in the first name field")
            nova.act(f"Enter '{person_data['last_name']}' in the last name field")
            nova.act("Select 'No' for the radio button option")
            
            print(f"\n📧 [Thread {thread_id}] Email and age verification for {person_name}...")
            nova.act(f"Enter '{person_data['email']}' in the business email field")
            nova.act("Select 'Yes' for being older than 18")
            
            print(f"\n➡️ [Thread {thread_id}] Proceeding to next section for {person_name}...")
            nova.act("Click the 'Next' button. If the page does not progress to the contact information page, check for any errors shown for incomplete fields, correct them, and then click 'Next' again.")
            
            print(f"\n📞 [Thread {thread_id}] Filling contact information for {person_name}...")
            nova.act(f"Enter '{person_data['phone']}' in the work phone field")
            nova.act("Select 'United States' from the work country dropdown")
            nova.act(f"Select '{person_data['state']}' from the work state dropdown")
            nova.act(f"Enter '{person_data['city']}' in the work city field")
            nova.act(f"Enter '{person_data['postal_code']}' in the work postal code field")
            nova.act(f"Enter '{person_data['job_title']}' in the job title field")
            nova.act("Select 'Developer/Engineer' from the job role dropdown")
            
            print(f"\n🏢 [Thread {thread_id}] Filling company information for {person_name}...")
            nova.act(f"Enter '{person_data['company']}' in the company name field")
            nova.act("Select 'Computers' from the industry dropdown")
            nova.act("Select 'Enterprise' from the company type dropdown")
            nova.act("Select '500-999 Employees' from the company size dropdown")
            nova.act("Select 'Run multiple production workloads on AWS' from the level of AWS usage dropdown")
            
            nova.act("Select 'No' radio button for AWS certification question")
            nova.act("Check the checkbox for 'Yes, I am interested' in AWS Digital Training")
            nova.act("Check the checkbox for 'Yes' for receiving latest news")
            
            print(f"\n❌ [Thread {thread_id}] Cancelling registration for {person_name}...")
            result = nova.act("Scroll down and look for a 'Cancel', 'Back', or 'Exit' button", schema=BOOL_SCHEMA)
            
            if result.matches_schema and result.parsed_response:
                nova.act("Click the Cancel button")
            else:
                nova.act("Navigate back to the main AWS Summit page")
            
            print(f"✅ [Thread {thread_id}] Registration completed for {person_name}")
            
            # Log the successful registration
            write_output_log(nova, f"Registration completed for {person_name}", 
                           {"person": person_data, "status": "completed"}, 
                           logs_directory=logs_dir)
            
            return {"success": True, "person": person_name, "thread_id": thread_id}
            
    except Exception as e:
        print(f"❌ [Thread {thread_id}] Error registering {person_name}: {str(e)}")
        
        # Log the error
        write_output_log(None, f"Registration failed for {person_name}", 
                       {"person": person_data, "error": str(e)}, 
                       type="error", logs_directory=logs_dir)
        
        return {"success": False, "person": person_name, "thread_id": thread_id, "error": str(e)}

def register_multiple_people_parallel(people_data, logs_dir, parent_session, max_workers=3):
    """
    Register multiple people in parallel
    """
    print(f"🌟 Starting parallel registration for {len(people_data)} people...")
    print(f"🔧 Using {max_workers} parallel workers")
    
    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all registration tasks
        future_to_person = {
            executor.submit(register_person, person, logs_dir, i+1, parent_session): person
            for i, person in enumerate(people_data)
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_person):
            result = future.result()
            results.append(result)
            

    output = DataInterface.create_array(
        source="",
        data=[
            DataInterface.create_array(
                source="",
                data=[
                    DataInterface.create_string(
                        source="",
                        data=f"total_people: {len(people_data)}"
                    ),
                    DataInterface.create_string(
                        source="",
                        data=f"successful_registrations: {len([r for r in results if r['success']])}"
                    ),
                    DataInterface.create_string(
                        source="",
                        data=f"failed_registrations: {len([r for r in results if not r['success']])}"
                    )
                ]
            ),
            DataInterface.create_table(
                source="",
                cols=[
                    Column("success", "Success"),
                    Column("person", "Person"),
                    Column("error", "Error")
                ],
                rows=[
                    {
                        "success": r['success'],
                        "person": r['person'],
                        "error": r.get('error', '')
                    }
                    for r in results
                ]
            )
        ],
        title="Registration Results"
    )
    
    save_final_output(output.to_dict(), logs_dir)
    
    return results


def verify_page_structure(logs_dir, parent_id):
    """
    Helper function to verify the AWS Summit page structure
    """
    print("🔍 Verifying AWS Summit page structure...")

    try:
        with NovaAct(starting_page="https://aws.amazon.com/events/summits/new-york",
                     headless=True,
                     record_video=True,
                     logs_directory=logs_dir) as nova:
            current_nova_id = nova.get_session_id()
            log_relationship(logs_dir, parent_id, current_nova_id)
            # Check if registration is available
            result = nova.act("Is there a registration button or link visible on this page?",
                              schema=BOOL_SCHEMA)

            if result.matches_schema and result.parsed_response:
                print("✅ Registration button found on the page")

                # Get more details about the registration
                info = nova.act("What does the registration button or section say?")
                print(f"📝 Registration info: {info.response}")

                return True, current_nova_id
            else:
                print("❌ No registration button found")
                print("💡 Registration may not be open yet, or the page structure has changed")
                save_final_output(DataInterface.create_string(source="", data="Page verification failed. Check the AWS Summit page manually."), logs_dir)
                return { False, current_nova_id }

    except Exception as e:
        print(f"❌ Error verifying page: {str(e)}")
        return False, current_nova_id


def main(logs_dir):
    """
    Main function to run the registration script
    """
    print("🌟 AWS Summit NYC Parallel Registration Script")
    print("=" * 55)

    # Check if Nova Act is properly configured
    if not os.getenv('NOVA_ACT_API_KEY'):
        print("❌ NOVA_ACT_API_KEY environment variable not set!")
        print("💡 Please set your API key: export NOVA_ACT_API_KEY='your_api_key'")
        print("🔗 Get your API key at: https://nova.amazon.com/act")
        sys.exit(1)

    print("\nWhat would you like to do?")
    print("1. Register multiple people in parallel")
    print("2. Verify page structure first")
    print("3. Both (verify then register)")

    choice = input("\nEnter your choice (1, 2, or 3): ").strip()

    if choice == "1":
        print(f"\n👥 Registering {len(PEOPLE_DATA)} people in parallel...")
        results = register_multiple_people_parallel(PEOPLE_DATA, logs_dir, 'start')
        
        print("\n📊 Registration Results:")
        successful = [r for r in results if r['success']]
        failed = [r for r in results if not r['success']]
        
        print(f"✅ Successful: {len(successful)}")
        for result in successful:
            print(f"   • {result['person']} (Thread {result['thread_id']})")
            
        if failed:
            print(f"❌ Failed: {len(failed)}")
            for result in failed:
                print(f"   • {result['person']} (Thread {result['thread_id']}): {result.get('error', 'Unknown error')}")

    elif choice == "2":
        verify_page_structure(logs_dir, 'start')

    elif choice == "3":
        print("\n🔍 First verifying page structure...")
        registration_open, session_id = verify_page_structure(logs_dir, 'start')
        if registration_open:
            print("\n✅ Page verified! Proceeding with parallel registration...")
            results = register_multiple_people_parallel(PEOPLE_DATA, logs_dir, session_id)
            
            print("\n📊 Registration Results:")
            successful = [r for r in results if r['success']]
            failed = [r for r in results if not r['success']]
            
            print(f"✅ Successful: {len(successful)}")
            for result in successful:
                print(f"   • {result['person']} (Thread {result['thread_id']})")
                
            if failed:
                print(f"❌ Failed: {len(failed)}")
                for result in failed:
                    print(f"   • {result['person']} (Thread {result['thread_id']}): {result.get('error', 'Unknown error')}")
        else:
            print("\n❌ Page verification failed. Check the AWS Summit page manually.")

    else:
        print("❌ Invalid choice. Please run the script again.")


if __name__ == "__main__":
    # Get filename without extension
    script_name = os.path.splitext(os.path.basename(__file__))[0]
    logs = create_temp_log_dirs(script_name)
    main(logs)