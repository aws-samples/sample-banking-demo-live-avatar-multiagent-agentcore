import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";

// Parse command-line arguments
const [, , distributionId] = process.argv;

// Configure AWS credentials
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_SESSION_TOKEN = process.env.AWS_SESSION_TOKEN;
const AWS_REGION = process.env.AWS_REGION;

// Initialize CloudFront client
const cloudfront = new CloudFrontClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    sessionToken: AWS_SESSION_TOKEN,
  },
});

// Function to create invalidation for the specified distribution
const createInvalidation = async (distributionId) => {
  const params = {
    DistributionId: distributionId,
    InvalidationBatch: {
      CallerReference: `${Date.now()}`,
      Paths: {
        Quantity: 1,
        Items: ["/*"], // Invalidate all objects in the distribution
      },
    },
  };

  try {
    const command = new CreateInvalidationCommand(params);
    const response = await cloudfront.send(command);
    console.log("Cache invalidation request submitted successfully:", response.Invalidation);
  } catch (error) {
    console.error("Error creating cache invalidation:", error);
  }
};

// Call the function to create the cache invalidation
createInvalidation(distributionId);
