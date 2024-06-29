const AWS = require('aws-sdk');

// Parse command-line arguments
const [, , distributionId] = process.argv;

// Configure AWS credentials
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

// Initialize CloudFront client
const cloudfront = new AWS.CloudFront();

// Function to create invalidation for the specified distribution
async function createInvalidation(distributionId) {
    const params = {
        DistributionId: distributionId,
        InvalidationBatch: {
            CallerReference: `${Date.now()}`,
            Paths: {
                Quantity: 1,
                Items: ['/*'] // Invalidate all objects in the distribution
            }
        }
    };

    try {
        const response = await cloudfront.createInvalidation(params).promise();
        console.log('Cache invalidation request submitted successfully:', response.Invalidation);
    } catch (error) {
        console.error('Error creating cache invalidation:', error);
    }
}

// Call the function to create the cache invalidation
createInvalidation(distributionId);