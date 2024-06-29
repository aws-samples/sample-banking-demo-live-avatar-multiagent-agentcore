const fs = require('fs');
const AWS = require('aws-sdk');
const path = require('path');

// Configure AWS credentials
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Read the cdk-outputs.json file
fs.readFile('cdk-outputs.json', 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading cdk-outputs.json:', err);
    return;
  }

  try {
    // Parse the JSON data
    const outputs = JSON.parse(data);

    // Extract the relevant values from the CDK outputs
    const backendStackOutputs = outputs['GenAILabs-Demo-BackendStack'];
    const frontendStackOutputs = outputs['GenAILabs-Demo-FrontendStack'];

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
    const s3 = new AWS.S3();

    // Set the parameters for uploading the file
    const webAppBucketName = backendStackOutputs['webAppBucketName'];
    const webAppPath = frontendStackOutputs['webAppPath'];
    const uploadParams = {
      Bucket: webAppBucketName,
      Key: `${webAppPath}/frontend-config.js`,
      Body: fs.createReadStream(frontendConfigFilePath),
      ContentType: 'application/javascript'
    };

    // Upload the file to the specified path in the webapp bucket
    s3.upload(uploadParams, (err, data) => {
      if (err) {
        console.error('Error uploading frontend-config.js to S3:', err);
        return;
      }
      console.log('frontend-config.js has been uploaded to S3 successfully.');
      console.log('Location:', data.Location);

      // Write the frontend-config.js file to the local ../webapp/build/ directory
      const localConfigPath = path.resolve(__dirname, '../webapp/build/frontend-config.js');
      fs.writeFileSync(localConfigPath, frontendConfigContent);
      console.log('frontend-config.js has been saved to the local directory:', localConfigPath);
    });
  } catch (error) {
    console.error('Error parsing cdk-outputs.json:', error);
  }
});