import chalk from "chalk";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CloudFormationClient, ListExportsCommand } from "@aws-sdk/client-cloudformation";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import * as envfile from 'envfile';
import mime from 'mime-types';
import { envConfig } from "./config";
import { envPath, executeCommand, goodBye, graphQLConfigFilePath, graphQLConfigTemplate, readAllFiles, spawnChild, webappStaticAssetsPath, webappDistPath, refreshCreds, webappHydrateAssetsPath, getProjectConfig } from "./utils";
import { AssumeRoleCommand, STSClient } from "@aws-sdk/client-sts";
import { AccountType, PresetStageType } from "../../shared";

// include a profile only if one is supplied and ensure
const profileStage = process.argv[2];

export type CredentialsType = {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
}

export const getCrossAccountCredentials = async (stage: string) => {
    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    const account = projectConfigJson.account[stage]
    if (!account) {
        console.error(`\n 🛑 Account not found. \n`);
        return
    }

    // this will set the default profile to DEV account so we fetch the cross account creds from Dev to target stage 

    await refreshCreds(PresetStageType.Dev)
    try {
        if (account) {
            const command = new AssumeRoleCommand({
                // The Amazon Resource Name (ARN) of the role to assume.
                RoleArn: `arn:aws:iam::${account.number}:role/${projectConfigJson.projectName}-deploy-website`,
                // An identifier for the assumed role session.
                RoleSessionName: `${projectConfigJson.projectName}-${profileStage ?? "dev"}`,
                // The duration, in seconds, of the role session. The value specified
                // can range from 900 seconds (15 minutes) up to the maximum session
                // duration set for the role.
                DurationSeconds: 900,
            });
            // Create an AWS STS service client object.
            const stsClient = new STSClient({ region: account.region });
            const response = await stsClient.send(command);
            if (response.Credentials) {
                // after creds rotation switch default creds back to stage received
                await refreshCreds(stage)
                console.log(chalk.greenBright(`\n Cross account credentials acquired 🟢\n`));
                return ({
                    accessKeyId: response.Credentials.AccessKeyId,
                    secretAccessKey: response.Credentials.SecretAccessKey,
                    sessionToken: response.Credentials.SessionToken,
                })
            }

        } else {
            console.error(`\n 🛑 Account not found \n`);
            goodBye()
        }
    }
    catch (error) {
        console.error(error);
        throw new Error("Unable to get credentials")
    }
    return null
}

const listExports = async (credentials: CredentialsType, region: string) => {

    try {
        const cfClient = new CloudFormationClient({
            region,
            credentials: {
                accessKeyId: credentials.accessKeyId ?? "",
                secretAccessKey: credentials.secretAccessKey ?? "",
                sessionToken: credentials.sessionToken ?? "",
            }
        });
        const command = new ListExportsCommand({});
        const response = await cfClient.send(command);
        // console.log("🚀 ~ listExports ~ response:", response)
        return response.Exports ?? []
    } catch (error) {
        console.error(error);
    }
    return []
}

const graphQLSetup = async (apiID: string, account: AccountType) => {
    try {
        // read a file in path 
        const graphQLConfigFile = readFileSync(graphQLConfigTemplate, 'utf8')
        const updatedData = graphQLConfigFile.replace("API_ID", apiID).replace("REGION", account.region);
        console.log("🚀 ~ graphQLSetup ~ updatedData:", updatedData)

        if (existsSync(graphQLConfigFilePath)) {
            console.log("Deleting existing GraphQL config file");
            unlinkSync(graphQLConfigFilePath)
        }
        writeFileSync(graphQLConfigFilePath, updatedData);
        console.log(chalk.greenBright("GraphQl Config file created successfully! ✅\n"));
    } catch (error) {
        throw new Error("Unable to generate GraphQL config file")
    }
}

export const setupWebsiteEnvironment = async (credentials: CredentialsType, stage: string) => {
    console.log(chalk.magenta(`\n Setting up local environment for website for stage - ${stage}  ... ⌛ \n`));

    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }

    const account = projectConfigJson.account[stage]
    if (!account) {
        console.error(`\n 🛑 Account not found. \n`);
        return
    }

    try {
        // list al CF exports
        const exports = await listExports(credentials, account.region)
        if (credentials && exports.length > 1) {
            // generate env variables in webapp folder
            const envObject = envConfig.reduce((acc, config) => {
                const exportItem = exports.find(e => e.Name === `${projectConfigJson.projectName}-${config.exportKey}`)
                return {
                    ...acc,
                    [config.envKey]: exportItem?.Value ?? ""
                };
            }, {})
            console.log("🚀 ~ envPath formed:", envPath)
            if (existsSync(envPath)) {
                // delete existing env file 
                console.log("Deleting existing env file");
                unlinkSync(envPath)
            } else {
                console.log("No existing env file found. Skipping deletion");
            }
            writeFileSync(envPath, envfile.stringify({
                VITE_PROJECT_NAME: projectConfigJson.projectName,
                VITE_REGION: account.region,
                VITE_MIDWAY: projectConfigJson.midway ?? "",
                ...envObject
            }));

            // graphql codegen automation
            const gqlAPiID = exports.find(e => e.Name === `${projectConfigJson.projectName}-config-appsync-api-id-output`)?.Value ?? "";
            if (gqlAPiID) {
                console.log(chalk.greenBright(`GraphQL API ID found! Setting up GraphQl Config ... ⌛\n`));
                await graphQLSetup(gqlAPiID, account)
                console.log(chalk.greenBright("Running GraphQl Codegen automation ..  ⌛\n"));
                if (!await executeCommand("npm run -w webapp codegen")) {
                    console.error(`\n🛑 Unable to setup codegen.\n`)
                }
                console.log(chalk.greenBright("GraphQl Codegen generated successfully! ✅\n"));
            }
            console.log(chalk.greenBright(`Env file created successfully! ✅\n`));
            return credentials
        } else {
            console.log(chalk.red('\n🛑 Missing required exports.\n'));
        }
    } catch (error) {
        console.error(chalk.red(`\n🛑 ${error}.\n`));
    }
    return null
}

const cleanBucket = async (s3Client: S3Client, bucket: string) => {

    const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
    });
    const listResponse = await s3Client.send(listCommand);
    if (!listResponse.Contents || listResponse.Contents.length === 0) {
        console.log(chalk.magenta('\n 🤔 No files to delete! Moving on... \n'));
        return
    }
    const deleteObjects = listResponse.Contents?.map(c => ({ "Key": c.Key }))

    const deleteCommand = new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
            Objects: deleteObjects
        }
    });
    await s3Client.send(deleteCommand);
    console.log(chalk.greenBright(`Bucket cleaned success! ✅\n`));
}


export const deployWebApp = async (credentials: CredentialsType, stage: string) => {

    const projectConfigJson = getProjectConfig()
    if (!projectConfigJson) {
        console.error(`\n 🛑 Project config not found. \n`);
        return
    }
    const account = projectConfigJson.account[stage]
    if (!account) {
        console.error(`\n 🛑 Account not found. \n`);
        return
    }
    // build web app 
    const webAppBuild = await spawnChild('npm', ['run', '-w', 'webapp', 'build'])
    console.log("🚀 ~ webapp build success:", webAppBuild)
    // list exports 
    const exports = await listExports(credentials, account.region)
    if (credentials && exports.length > 1) {
        // upload files to s3 website bucket 
        const s3Client = new S3Client({
            region: account.region,
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
            }
        });
        const websiteBucketName = exports.find(e => e.Name === `${projectConfigJson.projectName}-config-website-s3-bucket-name`)?.Value?.replace("s3://", "") ?? "";

        // clean bucket
        cleanBucket(s3Client, websiteBucketName)

        // upload website files
        for (const filePath of readAllFiles(webappDistPath)) {
            const file = readFileSync(filePath)
            const mimeType = mime.lookup(filePath)
            const s3UploadResp = await s3Client.send(new PutObjectCommand({
                Bucket: websiteBucketName,
                Key: filePath.replace(webappDistPath + "/", ''),
                Body: file,
                ContentType: !mimeType ? undefined : mimeType,
            }))
            console.log("🚀 ~ File uploaded:", s3UploadResp)
        }

        // upload all static assets from the assets folder in webapp/src/assets
        // upload all static assets from the assets folder in webapp/src/assets
        if (existsSync(webappStaticAssetsPath)) {
            for (const filePath of readAllFiles(webappStaticAssetsPath)) {
                const file = readFileSync(filePath)
                const mimeType = mime.lookup(filePath)
                const s3UploadResp = await s3Client.send(new PutObjectCommand({
                    Bucket: websiteBucketName,
                    Key: filePath.replace(webappStaticAssetsPath + "/", 'static/'),
                    Body: file,
                    ContentType: !mimeType ? undefined : mimeType,
                }))
                console.log("🚀 ~ Static Assets uploaded:", s3UploadResp)
            }

            console.log(chalk.greenBright(`Static file upload complete ${stage} account 🟢\n`));
        } else {
            console.log(chalk.magenta('\n 🤚 Static Assets folder not found. Skipping file upload\n'));

        }

        // invalidate cloudfront  distribution 
        const cfClient = new CloudFrontClient({
            region: account.region,
            credentials: {
                accessKeyId: credentials.accessKeyId,
                secretAccessKey: credentials.secretAccessKey,
                sessionToken: credentials.sessionToken,
            }
        });
        const DistributionId = exports.find(e => e.Name === `${projectConfigJson.projectName}-config-website-distribution-id`)?.Value ?? "";

        const invalidateCommand = new CreateInvalidationCommand({
            DistributionId,
            InvalidationBatch: {
                CallerReference: Date.now().toString(),
                Paths: {
                    Quantity: 1,
                    Items: ['/*']
                }
            },
        })
        const cfResponse = await cfClient.send(invalidateCommand);
        console.log("🚀 ~ Invalidation :", cfResponse)
        console.log(chalk.greenBright(`CloudFront Distribution Invalidated ${stage} account 🟢\n`));
    } else {
        console.log(chalk.red('\n🛑 Missing required exports.\n'));
    }

}



export const hydrate = async (credentials: CredentialsType, stage: string) => {
    try {

        const projectConfigJson = getProjectConfig()
        if (!projectConfigJson) {
            console.error(`\n 🛑 Project config not found. \n`);
            return
        }

        const account = projectConfigJson.account[stage]
        if (!account) {
            console.error(`\n 🛑 Account not found. \n`);
            return false
        }
        // list exports 
        const exports = await listExports(credentials, account.region)

        if (credentials && exports.length > 1) {
            // upload files to s3 website bucket
            const s3Client = new S3Client({
                region: account.region,
                credentials: {
                    accessKeyId: credentials.accessKeyId,
                    secretAccessKey: credentials.secretAccessKey,
                    sessionToken: credentials.sessionToken,
                }
            });
            const dataBucketName = exports.find(e => e.Name === `${projectConfigJson.projectName}-config-s3-data-bucket-name`)?.Value?.replace("s3://", "") ?? "";

            console.log("🚀 ~ hydrate ~ dataBucketName:", dataBucketName)
            // upload all static assets from the assets folder in webapp/src/assets
            for (const filePath of readAllFiles(webappHydrateAssetsPath)) {
                const file = readFileSync(filePath)
                const mimeType = mime.lookup(filePath)
                const s3UploadResp = await s3Client.send(new PutObjectCommand({
                    Bucket: dataBucketName,
                    Key: filePath.replace(webappHydrateAssetsPath + "/", ''),
                    Body: file,
                    ContentType: !mimeType ? undefined : mimeType,
                }))
                console.log("🚀 ~ Hydration Assets uploaded:", s3UploadResp)
            }
            console.log(chalk.greenBright(`Hydration completed ${stage} account ✅\n"`));
            return true
        } else {
            console.error(`\n 🛑 Unable to list exports for stage - ${stage}.\n`)
            return false
        }
    } catch (error) {
        console.log("🚀 ~ hydrate ~ error:", error)
        console.error(`\n 🛑 Hydration failed.\n`)
        return false
    }

}
