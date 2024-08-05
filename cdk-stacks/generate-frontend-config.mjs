import fs from 'fs';
import path from 'path';
import {PutObjectCommand, S3Client} from "@aws-sdk/client-s3";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)

// Configure AWS credentials
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
const AWS_REGION = process.env.AWS_REGION;

const FRONTEND_STACKNAME = 'GenAILabs-Demo-FrontendStack'
const BACKEND_STACKNAME = 'GenAILabs-Demo-BackendStack'


// Read the cdk-outputs.json file
fs.readFile('cdk-outputs.json', 'utf8', async (err, data) => {
  if (err) {
    console.error('Error reading cdk-outputs.json:', err);
    return;
  }

  try {
    // Parse the JSON data
    const outputs = JSON.parse(data);
    console.log(outputs);

    // Extract the relevant values from the CDK outputs
    const backendStackOutputs = outputs[BACKEND_STACKNAME];
    const frontendStackOutputs = outputs[FRONTEND_STACKNAME];

    // Create the frontend-config.js content
    let frontendConfigContent = 'window.frontendConfig = {\n';

    // Add the backend stack outputs to the config
    for (const key in backendStackOutputs) {
      if (!key.startsWith('ExportsOutput')) {
        frontendConfigContent += `  ${key}: '${backendStackOutputs[key]}',\n`;
      }
    }

    // Add the frontend stack outputs to the config
    for (const key in frontendStackOutputs) {
      if (!key.startsWith('ExportsOutput')) {
        frontendConfigContent += `  ${key}: '${frontendStackOutputs[key]}',\n`;
      }
    }

    frontendConfigContent += '};';

    // Write the frontend-config.js file to a temporary folder
    const frontendConfigFilePath = '/tmp/frontend-config.js';
    fs.writeFileSync(frontendConfigFilePath, frontendConfigContent);

    // Create an S3 client
    const s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
        sessionToken: AWS_SESSION_TOKEN,
      },
    });

    // Set the parameters for uploading the file
    const webAppBucketName = backendStackOutputs['webAppBucketName'];
    const webAppPath = frontendStackOutputs['webAppPath'];
    const uploadParams = {
      Bucket: webAppBucketName,
      Key: `${webAppPath}/frontend-config.js`,
      Body: fs.createReadStream(frontendConfigFilePath),
      ContentType: 'application/javascript',
    };

    // Upload the file to the specified path in the webapp bucket
    const uploadCommand = new PutObjectCommand(uploadParams);
    try {
      const s3UploadResponse = await s3Client.send(uploadCommand)
      console.log('frontend-config.js has been uploaded to S3 successfully.', s3UploadResponse);
      console.log('Location:', `${webAppBucketName}/${webAppPath}/frontend-config.js`);

    } catch {
      console.error('Error uploading frontend-config.js to S3:', err);
    }
    // Write the frontend-config.js file to the local ../webapp/build/ directory
    const localBuildPath = path.resolve(__dirname, '../webapp/build/frontend-config.js');
    fs.writeFileSync(localBuildPath, frontendConfigContent);
    console.log('frontend-config.js has been saved to the local build directory:', localBuildPath);

    const localConfigPath = path.resolve(__dirname, '../webapp/frontend-config.js');
    fs.writeFileSync(localConfigPath, frontendConfigContent);
    console.log('frontend-config.js has been saved to the local directory to allow for local dev:', localConfigPath);
  } catch (error) {
    console.error('Error parsing cdk-outputs.json:', error);
  }
});
