# Code to 'replay' a past timerange into Sitewise, with current timestamp

import boto3
import datetime
import time
import json
import threading
import os
import re
import uuid

replayPeriod = 15  # in seconds

client = boto3.client("iotsitewise")


def updateTimestamp(assetId, propertyId, assetPropertyValue):
    dt = datetime.datetime.now()  # Get timezone naive now
    seconds = int(dt.timestamp())
    entryId = str(uuid.uuid4())

    replayValue = assetPropertyValue
    replayValue["timestamp"]["timeInSeconds"] = seconds
    replayValue["timestamp"]["offsetInNanos"] = 0
    replayValuePut = [
        {
            "entryId": entryId,
            "assetId": assetId,
            "propertyId": propertyId,
            "propertyValues": [replayValue],
        }
    ]

    return replayValuePut


def process_file(assetID, propertyID, values):
    for value in values["values"]:
        try:
            entry = updateTimestamp(assetID, propertyID, value)
            client.batch_put_asset_property_value(entries=entry)
            # nosemgrep: arbitrary-sleep
            time.sleep(15)
        except Exception as e:
            print(str(e))


def run_simulation():
    directory_path = "data/"  # Replace with your actual directory path

    while True:
        # Get a list of files in the directory
        file_paths = [
            os.path.join(directory_path, f)
            for f in os.listdir(directory_path)
            if os.path.isfile(os.path.join(directory_path, f))
        ]

        # Create and start a thread for each file
        threads = []
        for file_path in file_paths:
            guid_pattern = (
                r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
            )
            filename = os.path.basename(file_path)

            # Find all matches in the filename
            matches = re.findall(guid_pattern, filename)

            if len(matches) >= 2:
                assetId = matches[0]
                propertyId = matches[1]
                with open(file_path, "r") as file:
                    data = json.load(file)
                    t = threading.Thread(
                        target=process_file, args=(assetId, propertyId, data)
                    )
                    threads.append(t)
                    t.start()

        # Wait for all threads to complete, then start over
        for t in threads:
            t.join()


run_simulation()
