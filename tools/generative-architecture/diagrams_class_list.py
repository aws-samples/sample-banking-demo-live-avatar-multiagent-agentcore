diagrams_aws_libraries = """

Turn these AWS Services and diagram module statements into Python import statements for diagrams module

All of the text below is to help define how to structure the Python imports like below

Example:

    Sagemaker diagrams.aws.ml.Sagemaker turns into:
    from diagrams.aws.ml import Sagemaker

    Or

    StorageGateway diagrams.aws.storage.StorageGateway turns into:
    from diagrams.aws.storage import StorageGateway

    Kinesis diagrams.aws.analytics.Kinesis ->
    from diagrams.aws.analytics import Kinesis


from diagrams import Diagram, Cluster
from diagrams.aws.analytics import Athena, Quicksight, Glue
from diagrams.aws.ml import Sagemaker
from diagrams.aws.database import Redshift
from diagrams.aws.storage import S3

Node classes list of aws provider.
aws.analytics

Analytics diagrams.aws.analytics.Analytics

Athena diagrams.aws.analytics.Athena

CloudsearchSearchDocuments diagrams.aws.analytics.CloudsearchSearchDocuments

Cloudsearch diagrams.aws.analytics.Cloudsearch

DataLakeResource diagrams.aws.analytics.DataLakeResource

DataPipeline diagrams.aws.analytics.DataPipeline

ElasticsearchService diagrams.aws.analytics.ElasticsearchService, ES (alias)

EMRCluster diagrams.aws.analytics.EMRCluster

EMREngineMaprM3 diagrams.aws.analytics.EMREngineMaprM3

EMREngineMaprM5 diagrams.aws.analytics.EMREngineMaprM5

EMREngineMaprM7 diagrams.aws.analytics.EMREngineMaprM7

EMREngine diagrams.aws.analytics.EMREngine

EMRHdfsCluster diagrams.aws.analytics.EMRHdfsCluster

EMR diagrams.aws.analytics.EMR

GlueCrawlers diagrams.aws.analytics.GlueCrawlers

GlueDataCatalog diagrams.aws.analytics.GlueDataCatalog

Glue diagrams.aws.analytics.Glue

KinesisDataAnalytics diagrams.aws.analytics.KinesisDataAnalytics

KinesisDataFirehose diagrams.aws.analytics.KinesisDataFirehose

KinesisDataStreams diagrams.aws.analytics.KinesisDataStreams

KinesisVideoStreams diagrams.aws.analytics.KinesisVideoStreams

Kinesis diagrams.aws.analytics.Kinesis

LakeFormation diagrams.aws.analytics.LakeFormation

ManagedStreamingForKafka diagrams.aws.analytics.ManagedStreamingForKafka

Quicksight diagrams.aws.analytics.Quicksight

RedshiftDenseComputeNode diagrams.aws.analytics.RedshiftDenseComputeNode

RedshiftDenseStorageNode diagrams.aws.analytics.RedshiftDenseStorageNode

Redshift diagrams.aws.analytics.Redshift
aws.ar

ArVr diagrams.aws.ar.ArVr

Sumerian diagrams.aws.ar.Sumerian
aws.blockchain

BlockchainResource diagrams.aws.blockchain.BlockchainResource

Blockchain diagrams.aws.blockchain.Blockchain

ManagedBlockchain diagrams.aws.blockchain.ManagedBlockchain

QuantumLedgerDatabaseQldb diagrams.aws.blockchain.QuantumLedgerDatabaseQldb, QLDB (alias)
aws.business

AlexaForBusiness diagrams.aws.business.AlexaForBusiness, A4B (alias)

BusinessApplications diagrams.aws.business.BusinessApplications

Chime diagrams.aws.business.Chime

Workmail diagrams.aws.business.Workmail
aws.compute

AppRunner diagrams.aws.compute.AppRunner

ApplicationAutoScaling diagrams.aws.compute.ApplicationAutoScaling, AutoScaling (alias)

Batch diagrams.aws.compute.Batch

ComputeOptimizer diagrams.aws.compute.ComputeOptimizer

Compute diagrams.aws.compute.Compute

EC2Ami diagrams.aws.compute.EC2Ami, AMI (alias)

EC2AutoScaling diagrams.aws.compute.EC2AutoScaling

EC2ContainerRegistryImage diagrams.aws.compute.EC2ContainerRegistryImage

EC2ContainerRegistryRegistry diagrams.aws.compute.EC2ContainerRegistryRegistry

EC2ContainerRegistry diagrams.aws.compute.EC2ContainerRegistry, ECR (alias)

EC2ElasticIpAddress diagrams.aws.compute.EC2ElasticIpAddress

EC2ImageBuilder diagrams.aws.compute.EC2ImageBuilder

EC2Instance diagrams.aws.compute.EC2Instance

EC2Instances diagrams.aws.compute.EC2Instances

EC2Rescue diagrams.aws.compute.EC2Rescue

EC2SpotInstance diagrams.aws.compute.EC2SpotInstance

EC2 diagrams.aws.compute.EC2

ElasticBeanstalkApplication diagrams.aws.compute.ElasticBeanstalkApplication

ElasticBeanstalkDeployment diagrams.aws.compute.ElasticBeanstalkDeployment

ElasticBeanstalk diagrams.aws.compute.ElasticBeanstalk, EB (alias)

ElasticContainerServiceContainer diagrams.aws.compute.ElasticContainerServiceContainer

ElasticContainerServiceService diagrams.aws.compute.ElasticContainerServiceService

ElasticContainerService diagrams.aws.compute.ElasticContainerService, ECS (alias)

ElasticKubernetesService diagrams.aws.compute.ElasticKubernetesService, EKS (alias)

Fargate diagrams.aws.compute.Fargate

LambdaFunction diagrams.aws.compute.LambdaFunction

Lambda diagrams.aws.compute.Lambda

Lightsail diagrams.aws.compute.Lightsail

LocalZones diagrams.aws.compute.LocalZones

Outposts diagrams.aws.compute.Outposts

ServerlessApplicationRepository diagrams.aws.compute.ServerlessApplicationRepository, SAR (alias)

ThinkboxDeadline diagrams.aws.compute.ThinkboxDeadline

ThinkboxDraft diagrams.aws.compute.ThinkboxDraft

ThinkboxFrost diagrams.aws.compute.ThinkboxFrost

ThinkboxKrakatoa diagrams.aws.compute.ThinkboxKrakatoa

ThinkboxSequoia diagrams.aws.compute.ThinkboxSequoia

ThinkboxStoke diagrams.aws.compute.ThinkboxStoke

ThinkboxXmesh diagrams.aws.compute.ThinkboxXmesh

VmwareCloudOnAWS diagrams.aws.compute.VmwareCloudOnAWS

Wavelength diagrams.aws.compute.Wavelength
aws.cost

Budgets diagrams.aws.cost.Budgets

CostAndUsageReport diagrams.aws.cost.CostAndUsageReport

CostExplorer diagrams.aws.cost.CostExplorer

CostManagement diagrams.aws.cost.CostManagement

ReservedInstanceReporting diagrams.aws.cost.ReservedInstanceReporting

SavingsPlans diagrams.aws.cost.SavingsPlans
aws.database

AuroraInstance diagrams.aws.database.AuroraInstance

Aurora diagrams.aws.database.Aurora

DatabaseMigrationServiceDatabaseMigrationWorkflow diagrams.aws.database.DatabaseMigrationServiceDatabaseMigrationWorkflow

DatabaseMigrationService diagrams.aws.database.DatabaseMigrationService, DMS (alias)

Database diagrams.aws.database.Database, DB (alias)

DocumentdbMongodbCompatibility diagrams.aws.database.DocumentdbMongodbCompatibility, DocumentDB (alias)

DynamodbAttribute diagrams.aws.database.DynamodbAttribute

DynamodbAttributes diagrams.aws.database.DynamodbAttributes

DynamodbDax diagrams.aws.database.DynamodbDax, DAX (alias)

DynamodbGlobalSecondaryIndex diagrams.aws.database.DynamodbGlobalSecondaryIndex, DynamodbGSI (alias)

DynamodbItem diagrams.aws.database.DynamodbItem

DynamodbItems diagrams.aws.database.DynamodbItems

DynamodbTable diagrams.aws.database.DynamodbTable

Dynamodb diagrams.aws.database.Dynamodb, DDB (alias)

ElasticacheCacheNode diagrams.aws.database.ElasticacheCacheNode

ElasticacheForMemcached diagrams.aws.database.ElasticacheForMemcached

ElasticacheForRedis diagrams.aws.database.ElasticacheForRedis

Elasticache diagrams.aws.database.Elasticache, ElastiCache (alias)

KeyspacesManagedApacheCassandraService diagrams.aws.database.KeyspacesManagedApacheCassandraService

Neptune diagrams.aws.database.Neptune

QuantumLedgerDatabaseQldb diagrams.aws.database.QuantumLedgerDatabaseQldb, QLDB (alias)

RDSInstance diagrams.aws.database.RDSInstance

RDSMariadbInstance diagrams.aws.database.RDSMariadbInstance

RDSMysqlInstance diagrams.aws.database.RDSMysqlInstance

RDSOnVmware diagrams.aws.database.RDSOnVmware

RDSOracleInstance diagrams.aws.database.RDSOracleInstance

RDSPostgresqlInstance diagrams.aws.database.RDSPostgresqlInstance

RDSSqlServerInstance diagrams.aws.database.RDSSqlServerInstance

RDS diagrams.aws.database.RDS

RedshiftDenseComputeNode diagrams.aws.database.RedshiftDenseComputeNode

RedshiftDenseStorageNode diagrams.aws.database.RedshiftDenseStorageNode

Redshift diagrams.aws.database.Redshift

Timestream diagrams.aws.database.Timestream
aws.devtools

CloudDevelopmentKit diagrams.aws.devtools.CloudDevelopmentKit

Cloud9Resource diagrams.aws.devtools.Cloud9Resource

Cloud9 diagrams.aws.devtools.Cloud9

Codebuild diagrams.aws.devtools.Codebuild

Codecommit diagrams.aws.devtools.Codecommit

Codedeploy diagrams.aws.devtools.Codedeploy

Codepipeline diagrams.aws.devtools.Codepipeline

Codestar diagrams.aws.devtools.Codestar

CommandLineInterface diagrams.aws.devtools.CommandLineInterface, CLI (alias)

DeveloperTools diagrams.aws.devtools.DeveloperTools, DevTools (alias)

ToolsAndSdks diagrams.aws.devtools.ToolsAndSdks

XRay diagrams.aws.devtools.XRay
aws.enablement

CustomerEnablement diagrams.aws.enablement.CustomerEnablement

Iq diagrams.aws.enablement.Iq

ManagedServices diagrams.aws.enablement.ManagedServices

ProfessionalServices diagrams.aws.enablement.ProfessionalServices

Support diagrams.aws.enablement.Support
aws.enduser

Appstream20 diagrams.aws.enduser.Appstream20

DesktopAndAppStreaming diagrams.aws.enduser.DesktopAndAppStreaming

Workdocs diagrams.aws.enduser.Workdocs

Worklink diagrams.aws.enduser.Worklink

Workspaces diagrams.aws.enduser.Workspaces
aws.engagement

Connect diagrams.aws.engagement.Connect

CustomerEngagement diagrams.aws.engagement.CustomerEngagement

Pinpoint diagrams.aws.engagement.Pinpoint

SimpleEmailServiceSesEmail diagrams.aws.engagement.SimpleEmailServiceSesEmail

SimpleEmailServiceSes diagrams.aws.engagement.SimpleEmailServiceSes, SES (alias)
aws.game

GameTech diagrams.aws.game.GameTech

Gamelift diagrams.aws.game.Gamelift
aws.general

Client diagrams.aws.general.Client

Disk diagrams.aws.general.Disk

Forums diagrams.aws.general.Forums

General diagrams.aws.general.General

GenericDatabase diagrams.aws.general.GenericDatabase

GenericFirewall diagrams.aws.general.GenericFirewall

GenericOfficeBuilding diagrams.aws.general.GenericOfficeBuilding, OfficeBuilding (alias)

GenericSamlToken diagrams.aws.general.GenericSamlToken

GenericSDK diagrams.aws.general.GenericSDK

InternetAlt1 diagrams.aws.general.InternetAlt1

InternetAlt2 diagrams.aws.general.InternetAlt2

InternetGateway diagrams.aws.general.InternetGateway

Marketplace diagrams.aws.general.Marketplace

MobileClient diagrams.aws.general.MobileClient

Multimedia diagrams.aws.general.Multimedia

OfficeBuilding diagrams.aws.general.OfficeBuilding

SamlToken diagrams.aws.general.SamlToken

SDK diagrams.aws.general.SDK

SslPadlock diagrams.aws.general.SslPadlock

TapeStorage diagrams.aws.general.TapeStorage

Toolkit diagrams.aws.general.Toolkit

TraditionalServer diagrams.aws.general.TraditionalServer

User diagrams.aws.general.User

Users diagrams.aws.general.Users
aws.integration

ApplicationIntegration diagrams.aws.integration.ApplicationIntegration

Appsync diagrams.aws.integration.Appsync

ConsoleMobileApplication diagrams.aws.integration.ConsoleMobileApplication

EventResource diagrams.aws.integration.EventResource

EventbridgeCustomEventBusResource diagrams.aws.integration.EventbridgeCustomEventBusResource

EventbridgeDefaultEventBusResource diagrams.aws.integration.EventbridgeDefaultEventBusResource

EventbridgeSaasPartnerEventBusResource diagrams.aws.integration.EventbridgeSaasPartnerEventBusResource

Eventbridge diagrams.aws.integration.Eventbridge

ExpressWorkflows diagrams.aws.integration.ExpressWorkflows

MQ diagrams.aws.integration.MQ

SimpleNotificationServiceSnsEmailNotification diagrams.aws.integration.SimpleNotificationServiceSnsEmailNotification

SimpleNotificationServiceSnsHttpNotification diagrams.aws.integration.SimpleNotificationServiceSnsHttpNotification

SimpleNotificationServiceSnsTopic diagrams.aws.integration.SimpleNotificationServiceSnsTopic

SimpleNotificationServiceSns diagrams.aws.integration.SimpleNotificationServiceSns, SNS (alias)

SimpleQueueServiceSqsMessage diagrams.aws.integration.SimpleQueueServiceSqsMessage

SimpleQueueServiceSqsQueue diagrams.aws.integration.SimpleQueueServiceSqsQueue

SimpleQueueServiceSqs diagrams.aws.integration.SimpleQueueServiceSqs, SQS (alias)

StepFunctions diagrams.aws.integration.StepFunctions, SF (alias)
aws.iot

Freertos diagrams.aws.iot.Freertos, FreeRTOS (alias)

InternetOfThings diagrams.aws.iot.InternetOfThings

Iot1Click diagrams.aws.iot.Iot1Click

IotAction diagrams.aws.iot.IotAction

IotActuator diagrams.aws.iot.IotActuator

IotAlexaEcho diagrams.aws.iot.IotAlexaEcho

IotAlexaEnabledDevice diagrams.aws.iot.IotAlexaEnabledDevice

IotAlexaSkill diagrams.aws.iot.IotAlexaSkill

IotAlexaVoiceService diagrams.aws.iot.IotAlexaVoiceService

IotAnalyticsChannel diagrams.aws.iot.IotAnalyticsChannel

IotAnalyticsDataSet diagrams.aws.iot.IotAnalyticsDataSet

IotAnalyticsDataStore diagrams.aws.iot.IotAnalyticsDataStore

IotAnalyticsNotebook diagrams.aws.iot.IotAnalyticsNotebook

IotAnalyticsPipeline diagrams.aws.iot.IotAnalyticsPipeline

IotAnalytics diagrams.aws.iot.IotAnalytics

IotBank diagrams.aws.iot.IotBank

IotBicycle diagrams.aws.iot.IotBicycle

IotButton diagrams.aws.iot.IotButton

IotCamera diagrams.aws.iot.IotCamera

IotCar diagrams.aws.iot.IotCar

IotCart diagrams.aws.iot.IotCart

IotCertificate diagrams.aws.iot.IotCertificate

IotCoffeePot diagrams.aws.iot.IotCoffeePot

IotCore diagrams.aws.iot.IotCore

IotDesiredState diagrams.aws.iot.IotDesiredState

IotDeviceDefender diagrams.aws.iot.IotDeviceDefender

IotDeviceGateway diagrams.aws.iot.IotDeviceGateway

IotDeviceManagement diagrams.aws.iot.IotDeviceManagement

IotDoorLock diagrams.aws.iot.IotDoorLock

IotEvents diagrams.aws.iot.IotEvents

IotFactory diagrams.aws.iot.IotFactory

IotFireTvStick diagrams.aws.iot.IotFireTvStick

IotFireTv diagrams.aws.iot.IotFireTv

IotGeneric diagrams.aws.iot.IotGeneric

IotGreengrassConnector diagrams.aws.iot.IotGreengrassConnector

IotGreengrass diagrams.aws.iot.IotGreengrass

IotHardwareBoard diagrams.aws.iot.IotHardwareBoard, IotBoard (alias)

IotHouse diagrams.aws.iot.IotHouse

IotHttp diagrams.aws.iot.IotHttp

IotHttp2 diagrams.aws.iot.IotHttp2

IotJobs diagrams.aws.iot.IotJobs

IotLambda diagrams.aws.iot.IotLambda

IotLightbulb diagrams.aws.iot.IotLightbulb

IotMedicalEmergency diagrams.aws.iot.IotMedicalEmergency

IotMqtt diagrams.aws.iot.IotMqtt

IotOverTheAirUpdate diagrams.aws.iot.IotOverTheAirUpdate

IotPolicyEmergency diagrams.aws.iot.IotPolicyEmergency

IotPolicy diagrams.aws.iot.IotPolicy

IotReportedState diagrams.aws.iot.IotReportedState

IotRule diagrams.aws.iot.IotRule

IotSensor diagrams.aws.iot.IotSensor

IotServo diagrams.aws.iot.IotServo

IotShadow diagrams.aws.iot.IotShadow

IotSimulator diagrams.aws.iot.IotSimulator

IotSitewise diagrams.aws.iot.IotSitewise

IotThermostat diagrams.aws.iot.IotThermostat

IotThingsGraph diagrams.aws.iot.IotThingsGraph

IotTopic diagrams.aws.iot.IotTopic

IotTravel diagrams.aws.iot.IotTravel

IotUtility diagrams.aws.iot.IotUtility

IotWindfarm diagrams.aws.iot.IotWindfarm
aws.management

AutoScaling diagrams.aws.management.AutoScaling

Chatbot diagrams.aws.management.Chatbot

CloudformationChangeSet diagrams.aws.management.CloudformationChangeSet

CloudformationStack diagrams.aws.management.CloudformationStack

CloudformationTemplate diagrams.aws.management.CloudformationTemplate

Cloudformation diagrams.aws.management.Cloudformation

Cloudtrail diagrams.aws.management.Cloudtrail

CloudwatchAlarm diagrams.aws.management.CloudwatchAlarm

CloudwatchEventEventBased diagrams.aws.management.CloudwatchEventEventBased

CloudwatchEventTimeBased diagrams.aws.management.CloudwatchEventTimeBased

CloudwatchRule diagrams.aws.management.CloudwatchRule

Cloudwatch diagrams.aws.management.Cloudwatch

Codeguru diagrams.aws.management.Codeguru

CommandLineInterface diagrams.aws.management.CommandLineInterface

Config diagrams.aws.management.Config

ControlTower diagrams.aws.management.ControlTower

LicenseManager diagrams.aws.management.LicenseManager

ManagedServices diagrams.aws.management.ManagedServices

ManagementAndGovernance diagrams.aws.management.ManagementAndGovernance

ManagementConsole diagrams.aws.management.ManagementConsole

OpsworksApps diagrams.aws.management.OpsworksApps

OpsworksDeployments diagrams.aws.management.OpsworksDeployments

OpsworksInstances diagrams.aws.management.OpsworksInstances

OpsworksLayers diagrams.aws.management.OpsworksLayers

OpsworksMonitoring diagrams.aws.management.OpsworksMonitoring

OpsworksPermissions diagrams.aws.management.OpsworksPermissions

OpsworksResources diagrams.aws.management.OpsworksResources

OpsworksStack diagrams.aws.management.OpsworksStack

Opsworks diagrams.aws.management.Opsworks

OrganizationsAccount diagrams.aws.management.OrganizationsAccount

OrganizationsOrganizationalUnit diagrams.aws.management.OrganizationsOrganizationalUnit

Organizations diagrams.aws.management.Organizations

PersonalHealthDashboard diagrams.aws.management.PersonalHealthDashboard

ServiceCatalog diagrams.aws.management.ServiceCatalog

SystemsManagerAutomation diagrams.aws.management.SystemsManagerAutomation

SystemsManagerDocuments diagrams.aws.management.SystemsManagerDocuments

SystemsManagerInventory diagrams.aws.management.SystemsManagerInventory

SystemsManagerMaintenanceWindows diagrams.aws.management.SystemsManagerMaintenanceWindows

SystemsManagerOpscenter diagrams.aws.management.SystemsManagerOpscenter

SystemsManagerParameterStore diagrams.aws.management.SystemsManagerParameterStore, ParameterStore (alias)

SystemsManagerPatchManager diagrams.aws.management.SystemsManagerPatchManager

SystemsManagerRunCommand diagrams.aws.management.SystemsManagerRunCommand

SystemsManagerStateManager diagrams.aws.management.SystemsManagerStateManager

SystemsManager diagrams.aws.management.SystemsManager, SSM (alias)

TrustedAdvisorChecklistCost diagrams.aws.management.TrustedAdvisorChecklistCost

TrustedAdvisorChecklistFaultTolerant diagrams.aws.management.TrustedAdvisorChecklistFaultTolerant

TrustedAdvisorChecklistPerformance diagrams.aws.management.TrustedAdvisorChecklistPerformance

TrustedAdvisorChecklistSecurity diagrams.aws.management.TrustedAdvisorChecklistSecurity

TrustedAdvisorChecklist diagrams.aws.management.TrustedAdvisorChecklist

TrustedAdvisor diagrams.aws.management.TrustedAdvisor

WellArchitectedTool diagrams.aws.management.WellArchitectedTool
aws.media

ElasticTranscoder diagrams.aws.media.ElasticTranscoder

ElementalConductor diagrams.aws.media.ElementalConductor

ElementalDelta diagrams.aws.media.ElementalDelta

ElementalLive diagrams.aws.media.ElementalLive

ElementalMediaconnect diagrams.aws.media.ElementalMediaconnect

ElementalMediaconvert diagrams.aws.media.ElementalMediaconvert

ElementalMedialive diagrams.aws.media.ElementalMedialive

ElementalMediapackage diagrams.aws.media.ElementalMediapackage

ElementalMediastore diagrams.aws.media.ElementalMediastore

ElementalMediatailor diagrams.aws.media.ElementalMediatailor

ElementalServer diagrams.aws.media.ElementalServer

KinesisVideoStreams diagrams.aws.media.KinesisVideoStreams

MediaServices diagrams.aws.media.MediaServices
aws.migration

ApplicationDiscoveryService diagrams.aws.migration.ApplicationDiscoveryService, ADS (alias)

CloudendureMigration diagrams.aws.migration.CloudendureMigration, CEM (alias)

DatabaseMigrationService diagrams.aws.migration.DatabaseMigrationService, DMS (alias)

DatasyncAgent diagrams.aws.migration.DatasyncAgent

Datasync diagrams.aws.migration.Datasync

MigrationAndTransfer diagrams.aws.migration.MigrationAndTransfer, MAT (alias)

MigrationHub diagrams.aws.migration.MigrationHub

ServerMigrationService diagrams.aws.migration.ServerMigrationService, SMS (alias)

SnowballEdge diagrams.aws.migration.SnowballEdge

Snowball diagrams.aws.migration.Snowball

Snowmobile diagrams.aws.migration.Snowmobile

TransferForSftp diagrams.aws.migration.TransferForSftp
aws.ml

ApacheMxnetOnAWS diagrams.aws.ml.ApacheMxnetOnAWS

AugmentedAi diagrams.aws.ml.AugmentedAi

Comprehend diagrams.aws.ml.Comprehend

DeepLearningAmis diagrams.aws.ml.DeepLearningAmis

DeepLearningContainers diagrams.aws.ml.DeepLearningContainers, DLC (alias)

Deepcomposer diagrams.aws.ml.Deepcomposer

Deeplens diagrams.aws.ml.Deeplens

Deepracer diagrams.aws.ml.Deepracer

ElasticInference diagrams.aws.ml.ElasticInference

Forecast diagrams.aws.ml.Forecast

FraudDetector diagrams.aws.ml.FraudDetector

Kendra diagrams.aws.ml.Kendra

Lex diagrams.aws.ml.Lex

MachineLearning diagrams.aws.ml.MachineLearning

Personalize diagrams.aws.ml.Personalize

Polly diagrams.aws.ml.Polly

RekognitionImage diagrams.aws.ml.RekognitionImage

RekognitionVideo diagrams.aws.ml.RekognitionVideo

Rekognition diagrams.aws.ml.Rekognition

SagemakerGroundTruth diagrams.aws.ml.SagemakerGroundTruth

SagemakerModel diagrams.aws.ml.SagemakerModel

SagemakerNotebook diagrams.aws.ml.SagemakerNotebook

SagemakerTrainingJob diagrams.aws.ml.SagemakerTrainingJob

Sagemaker diagrams.aws.ml.Sagemaker

TensorflowOnAWS diagrams.aws.ml.TensorflowOnAWS

Textract diagrams.aws.ml.Textract

Transcribe diagrams.aws.ml.Transcribe

Translate diagrams.aws.ml.Translate
aws.mobile

Amplify diagrams.aws.mobile.Amplify

APIGatewayEndpoint diagrams.aws.mobile.APIGatewayEndpoint

APIGateway diagrams.aws.mobile.APIGateway

Appsync diagrams.aws.mobile.Appsync

DeviceFarm diagrams.aws.mobile.DeviceFarm

Mobile diagrams.aws.mobile.Mobile

Pinpoint diagrams.aws.mobile.Pinpoint
aws.network

APIGatewayEndpoint diagrams.aws.network.APIGatewayEndpoint

APIGateway diagrams.aws.network.APIGateway

AppMesh diagrams.aws.network.AppMesh

ClientVpn diagrams.aws.network.ClientVpn

CloudMap diagrams.aws.network.CloudMap

CloudFrontDownloadDistribution diagrams.aws.network.CloudFrontDownloadDistribution

CloudFrontEdgeLocation diagrams.aws.network.CloudFrontEdgeLocation

CloudFrontStreamingDistribution diagrams.aws.network.CloudFrontStreamingDistribution

CloudFront diagrams.aws.network.CloudFront, CF (alias)

DirectConnect diagrams.aws.network.DirectConnect

ElasticLoadBalancing diagrams.aws.network.ElasticLoadBalancing, ELB (alias)

ElbApplicationLoadBalancer diagrams.aws.network.ElbApplicationLoadBalancer, ALB (alias)

ElbClassicLoadBalancer diagrams.aws.network.ElbClassicLoadBalancer, CLB (alias)

ElbNetworkLoadBalancer diagrams.aws.network.ElbNetworkLoadBalancer, NLB (alias)

Endpoint diagrams.aws.network.Endpoint

GlobalAccelerator diagrams.aws.network.GlobalAccelerator, GAX (alias)

InternetGateway diagrams.aws.network.InternetGateway

Nacl diagrams.aws.network.Nacl

NATGateway diagrams.aws.network.NATGateway

NetworkingAndContentDelivery diagrams.aws.network.NetworkingAndContentDelivery

PrivateSubnet diagrams.aws.network.PrivateSubnet

Privatelink diagrams.aws.network.Privatelink

PublicSubnet diagrams.aws.network.PublicSubnet

Route53HostedZone diagrams.aws.network.Route53HostedZone

Route53 diagrams.aws.network.Route53

RouteTable diagrams.aws.network.RouteTable

SiteToSiteVpn diagrams.aws.network.SiteToSiteVpn

TransitGateway diagrams.aws.network.TransitGateway

VPCCustomerGateway diagrams.aws.network.VPCCustomerGateway

VPCElasticNetworkAdapter diagrams.aws.network.VPCElasticNetworkAdapter

VPCElasticNetworkInterface diagrams.aws.network.VPCElasticNetworkInterface

VPCFlowLogs diagrams.aws.network.VPCFlowLogs

VPCPeering diagrams.aws.network.VPCPeering

VPCRouter diagrams.aws.network.VPCRouter

VPCTrafficMirroring diagrams.aws.network.VPCTrafficMirroring

VPC diagrams.aws.network.VPC

VpnConnection diagrams.aws.network.VpnConnection

VpnGateway diagrams.aws.network.VpnGateway
aws.quantum

Braket diagrams.aws.quantum.Braket

QuantumTechnologies diagrams.aws.quantum.QuantumTechnologies
aws.robotics

RobomakerCloudExtensionRos diagrams.aws.robotics.RobomakerCloudExtensionRos

RobomakerDevelopmentEnvironment diagrams.aws.robotics.RobomakerDevelopmentEnvironment

RobomakerFleetManagement diagrams.aws.robotics.RobomakerFleetManagement

RobomakerSimulator diagrams.aws.robotics.RobomakerSimulator

Robomaker diagrams.aws.robotics.Robomaker

Robotics diagrams.aws.robotics.Robotics
aws.satellite

GroundStation diagrams.aws.satellite.GroundStation

Satellite diagrams.aws.satellite.Satellite
aws.security

AdConnector diagrams.aws.security.AdConnector

Artifact diagrams.aws.security.Artifact

CertificateAuthority diagrams.aws.security.CertificateAuthority

CertificateManager diagrams.aws.security.CertificateManager, ACM (alias)

CloudDirectory diagrams.aws.security.CloudDirectory

Cloudhsm diagrams.aws.security.Cloudhsm, CloudHSM (alias)

Cognito diagrams.aws.security.Cognito

Detective diagrams.aws.security.Detective

DirectoryService diagrams.aws.security.DirectoryService, DS (alias)

FirewallManager diagrams.aws.security.FirewallManager, FMS (alias)

Guardduty diagrams.aws.security.Guardduty

IdentityAndAccessManagementIamAccessAnalyzer diagrams.aws.security.IdentityAndAccessManagementIamAccessAnalyzer, IAMAccessAnalyzer (alias)

IdentityAndAccessManagementIamAddOn diagrams.aws.security.IdentityAndAccessManagementIamAddOn

IdentityAndAccessManagementIamAWSStsAlternate diagrams.aws.security.IdentityAndAccessManagementIamAWSStsAlternate

IdentityAndAccessManagementIamAWSSts diagrams.aws.security.IdentityAndAccessManagementIamAWSSts, IAMAWSSts (alias)

IdentityAndAccessManagementIamDataEncryptionKey diagrams.aws.security.IdentityAndAccessManagementIamDataEncryptionKey

IdentityAndAccessManagementIamEncryptedData diagrams.aws.security.IdentityAndAccessManagementIamEncryptedData

IdentityAndAccessManagementIamLongTermSecurityCredential diagrams.aws.security.IdentityAndAccessManagementIamLongTermSecurityCredential

IdentityAndAccessManagementIamMfaToken diagrams.aws.security.IdentityAndAccessManagementIamMfaToken

IdentityAndAccessManagementIamPermissions diagrams.aws.security.IdentityAndAccessManagementIamPermissions, IAMPermissions (alias)

IdentityAndAccessManagementIamRole diagrams.aws.security.IdentityAndAccessManagementIamRole, IAMRole (alias)

IdentityAndAccessManagementIamTemporarySecurityCredential diagrams.aws.security.IdentityAndAccessManagementIamTemporarySecurityCredential

IdentityAndAccessManagementIam diagrams.aws.security.IdentityAndAccessManagementIam, IAM (alias)

InspectorAgent diagrams.aws.security.InspectorAgent

Inspector diagrams.aws.security.Inspector

KeyManagementService diagrams.aws.security.KeyManagementService, KMS (alias)

Macie diagrams.aws.security.Macie

ManagedMicrosoftAd diagrams.aws.security.ManagedMicrosoftAd

ResourceAccessManager diagrams.aws.security.ResourceAccessManager, RAM (alias)

SecretsManager diagrams.aws.security.SecretsManager

SecurityHubFinding diagrams.aws.security.SecurityHubFinding

SecurityHub diagrams.aws.security.SecurityHub

SecurityIdentityAndCompliance diagrams.aws.security.SecurityIdentityAndCompliance

ShieldAdvanced diagrams.aws.security.ShieldAdvanced

Shield diagrams.aws.security.Shield

SimpleAd diagrams.aws.security.SimpleAd

SingleSignOn diagrams.aws.security.SingleSignOn

WAFFilteringRule diagrams.aws.security.WAFFilteringRule

WAF diagrams.aws.security.WAF
aws.storage

Backup diagrams.aws.storage.Backup

CloudendureDisasterRecovery diagrams.aws.storage.CloudendureDisasterRecovery, CDR (alias)

EFSInfrequentaccessPrimaryBg diagrams.aws.storage.EFSInfrequentaccessPrimaryBg

EFSStandardPrimaryBg diagrams.aws.storage.EFSStandardPrimaryBg

ElasticBlockStoreEBSSnapshot diagrams.aws.storage.ElasticBlockStoreEBSSnapshot

ElasticBlockStoreEBSVolume diagrams.aws.storage.ElasticBlockStoreEBSVolume

ElasticBlockStoreEBS diagrams.aws.storage.ElasticBlockStoreEBS, EBS (alias)

ElasticFileSystemEFSFileSystem diagrams.aws.storage.ElasticFileSystemEFSFileSystem

ElasticFileSystemEFS diagrams.aws.storage.ElasticFileSystemEFS, EFS (alias)

FsxForLustre diagrams.aws.storage.FsxForLustre

FsxForWindowsFileServer diagrams.aws.storage.FsxForWindowsFileServer

Fsx diagrams.aws.storage.Fsx, FSx (alias)

MultipleVolumesResource diagrams.aws.storage.MultipleVolumesResource

S3GlacierArchive diagrams.aws.storage.S3GlacierArchive

S3GlacierVault diagrams.aws.storage.S3GlacierVault

S3Glacier diagrams.aws.storage.S3Glacier

SimpleStorageServiceS3BucketWithObjects diagrams.aws.storage.SimpleStorageServiceS3BucketWithObjects

SimpleStorageServiceS3Bucket diagrams.aws.storage.SimpleStorageServiceS3Bucket

SimpleStorageServiceS3Object diagrams.aws.storage.SimpleStorageServiceS3Object

SimpleStorageServiceS3 diagrams.aws.storage.SimpleStorageServiceS3, S3 (alias)

SnowFamilySnowballImportExport diagrams.aws.storage.SnowFamilySnowballImportExport

SnowballEdge diagrams.aws.storage.SnowballEdge

Snowball diagrams.aws.storage.Snowball

Snowmobile diagrams.aws.storage.Snowmobile

StorageGatewayCachedVolume diagrams.aws.storage.StorageGatewayCachedVolume

StorageGatewayNonCachedVolume diagrams.aws.storage.StorageGatewayNonCachedVolume

StorageGatewayVirtualTapeLibrary diagrams.aws.storage.StorageGatewayVirtualTapeLibrary

StorageGateway diagrams.aws.storage.StorageGateway

Storage diagrams.aws.storage.Storage

--------------
All of the text above was to help define how to structure the Python imports like below

Example:

    Sagemaker diagrams.aws.ml.Sagemaker turns into:
    from diagrams.aws.ml import Sagemaker


    Or

    StorageGateway diagrams.aws.storage.StorageGateway turns into:
    from diagrams.aws.storage import StorageGateway


from diagrams import Diagram, Cluster
from diagrams.aws.analytics import Athena, Quicksight, Glue
from diagrams.aws.ml import Sagemaker
from diagrams.aws.database import Redshift
from diagrams.aws.storage import S3

"""
