// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const LambdaUtility = require('../../lib/LambdaUtility');
import { Context, APIGatewayEvent } from 'aws-lambda';

exports.handler = async (event: APIGatewayEvent, context: Context) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.debug(`Event: `, event);

        return LambdaUtility.buildLambdaResponse(context, 201, {
          success: 'Create Demo succeeded!',
          data: {},
        });
    }
    catch (error: any) {
        console.error(error);
        return LambdaUtility.buildLambdaResponse(context, error.statusCode || 500, { message: error.message });
    }
}