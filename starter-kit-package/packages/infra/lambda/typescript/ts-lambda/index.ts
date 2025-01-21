export const handler = async (event: any, context: any) => {
    console.log("🚀 ~ handler ~ event:", event)

    const responseBody = {
        message: "Hello from Typescript Lambda!"
    };
    return {
        // CORS
        headers: {
            'Content-Type': 'application/json',
        },

        statusCode: 200,
        body: JSON.stringify(responseBody)
    };

};