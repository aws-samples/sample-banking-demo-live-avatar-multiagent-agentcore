# Code to 'replay' a past timerange into Sitewise, with current timestamp

import boto3
import datetime
import json

client = boto3.client("iotsitewise")


def read_list_asset_models():
    """
    Reads a list of AWS IoT SiteWise asset models.

    Returns:
        list: A list of dictionaries containing asset model information, each with the following keys:
            - "id" (str): The ID of the asset model.
            - "name" (str): The name of the asset model.
            - "description" (str): The description of the asset model.
    """
    response = client.list_asset_models(maxResults=100, assetModelTypes=["ASSET_MODEL"])

    listAssetsModels = response["assetModelSummaries"]

    while "nextToken" in response:
        response = client.list_asset_models(
            maxResults=100,
            assetModelTypes=["ASSET_MODEL"],
            nextToken=response["nextToken"],
        )

        listAssetsModels.extend(response["assetModelSummaries"])

    return listAssetsModels


def read_asset_property_values_interpolated(
    asset_id, property_id, start_time, end_time, interval
):
    """
    Reads AWS IoT Sitewise asset property values between two timestamps with an interval

    Args:
        asset_id (str): The ID of the asset.
        property_id (str): The ID of the property.
        start_time (str): The start timestamp in ISO 8601 format (e.g. "2022-01-01T00:00:00Z").
        end_time (str): The end timestamp in ISO 8601 format (e.g. "2022-01-01T00:00:00Z").
        interval (int): 15 second interval
    Returns:
        list: A list of dictionaries containing the property values, each with the following keys:
            - "timestamp" (str): The timestamp of the value.
            - "value" (dict): The value of the property, with keys "doubleValue", "stringValue", etc.
    """
    # iotsitewise = boto3.client("iotsitewise")

    response = client.get_interpolated_asset_property_values(
        assetId=asset_id,
        propertyId=property_id,
        startTimeInSeconds=start_time,
        endTimeInSeconds=end_time,
        intervalInSeconds=interval,
        type="LOCF_INTERPOLATION",
        quality="GOOD",
    )
    # print(response)
    property_values = response["interpolatedAssetPropertyValues"]

    # print(property_values)
    while "nextToken" in response:
        response = client.get_interpolated_asset_property_values(
            assetId=asset_id,
            propertyId=property_id,
            startTimeInSeconds=start_time,
            endTimeInSeconds=end_time,
            quality="GOOD",
            type="LOCF_INTERPOLATION",
            intervalInSeconds=interval,
            nextToken=response["nextToken"],
        )
        property_values.extend(response["interpolatedAssetPropertyValues"])

    return property_values


def read_asset_property_values(asset_id, property_id, start_time, end_time):
    """
    Reads AWS IoT Sitewise asset property values between two timestamps.

    Args:
        asset_id (str): The ID of the asset.
        property_id (str): The ID of the property.
        start_time (str): The start timestamp in ISO 8601 format (e.g. "2022-01-01T00:00:00Z").
        end_time (str): The end timestamp in ISO 8601 format (e.g. "2022-01-01T00:00:00Z").

    Returns:
        list: A list of dictionaries containing the property values, each with the following keys:
            - "timestamp" (str): The timestamp of the value.
            - "value" (dict): The value of the property, with keys "doubleValue", "stringValue", etc.
    """
    # iotsitewise = boto3.client("iotsitewise")

    response = client.get_asset_property_value_history(
        assetId=asset_id,
        propertyId=property_id,
        startDate=start_time,
        endDate=end_time,
        timeOrdering="ASCENDING",
        # qualities=['GOOD']
    )
    # print(response)
    property_values = response["assetPropertyValueHistory"]
    # print(property_values)
    while "nextToken" in response:
        response = client.get_asset_property_value_history(
            assetId=asset_id,
            propertyId=property_id,
            startDate=start_time,
            endDate=end_time,
            # qualities=['GOOD'],
            timeOrdering="ASCENDING",
            nextToken=response["nextToken"],
        )
        property_values.extend(response["assetPropertyValueHistory"])

    return property_values


def read_list_assets(asset_model_id):
    """
    Reads a list of AWS IoT SiteWise assets for a given asset model ID.

    Args:
        asset_model_id (str): The ID of the asset model.

    Returns:
        list: A list of dictionaries containing asset information, each with the following keys:
            - "id" (str): The ID of the asset.
            - "name" (str): The name of the asset.
            - "description" (str): The description of the asset.
    """
    response = client.list_assets(assetModelId=asset_model_id, maxResults=100)

    list_assets = response["assetSummaries"]

    while "nextToken" in response:
        response = client.list_assets(
            assetModelId=asset_model_id, maxResults=100, nextToken=response["nextToken"]
        )

        list_assets.extend(response["assetSummaries"])

    return list_assets


def extract():
    replayStartTime = datetime.datetime(2024, 4, 23, 6, 45, 0)
    replayEndTime = datetime.datetime(2024, 4, 23, 10, 00, 0)

    replayPeriod = 15  # in seconds

    fullListAssets = []
    fullListAssetsProperties = []

    object_key = "data.json"

    # Wre create the tree of assets properties
    # we start by listing all asset models

    listAssetsModels = read_list_asset_models()

    print("Size: ", len(listAssetsModels), " asset models")

    # we then create the list of the assets for each asset model

    for assetModel in listAssetsModels:
        if assetModel["name"]:  # == "UniversalRoboticModel":
            print("Asset Model: ", assetModel["name"], " :", assetModel["id"])

            fullListAssets.extend(read_list_assets(assetModel["id"]))

    print("Size: ", len(fullListAssets), " assets")

    # we create the list of properties for each asset
    print("Building list of assets and measurements")
    for asset in fullListAssets:
        listAssetProperties = client.list_asset_properties(
            assetId=asset["id"], maxResults=200, filter="BASE"
        )

        assetId = asset["id"]

        numberMeasurements = 0

        for property in listAssetProperties["assetPropertySummaries"]:
            response = client.describe_asset_property(
                assetId=assetId, propertyId=property["path"][1]["id"]
            )

            # we only include in the list of properties the measurements

            if "measurement" in response["assetProperty"]["type"]:
                fullListAssetsProperties.extend([property])
                numberMeasurements += 1

        print(
            "Asset: ",
            asset["name"],
            " :",
            assetId,
            " - Measurements: ",
            numberMeasurements,
        )

    print(
        "Total measurements: ",
        len(fullListAssetsProperties),
        " asset properties (measurements)",
    )

    for index, assetProperty in enumerate(fullListAssetsProperties):
        try:
            assetId = assetProperty["path"][0]["id"]
            propertyId = assetProperty["path"][1]["id"]
            property_values = read_asset_property_values_interpolated(
                assetId,
                propertyId,
                int(replayStartTime.timestamp()),
                int(replayEndTime.timestamp()),
                replayPeriod,
            )
            property_values = {"values": property_values}

            with open(f"./data/{assetId}_{propertyId}_{object_key}", "w") as f:
                json.dump(property_values, f)
            print(f"JSON data saved /data/{assetId}/{propertyId}/{object_key}")
        except Exception as e:
            print(f"Error saving JSON to disk: {e}")


extract()
