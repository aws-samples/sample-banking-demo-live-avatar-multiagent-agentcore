// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { buildLambdaResponse } from '../../lib/LambdaUtility';
import { Context, APIGatewayEvent } from 'aws-lambda';

exports.handler = async (event: APIGatewayEvent, context: Context) => {

  try {
    console.info("App Version:", process.env.APPLICATION_VERSION)
    console.debug(`Event: `, event);

    return buildLambdaResponse(context, 201, {
      success: 'Create Demo succeeded!',
      data: {},
    });
  }
  catch (error: any) {
    console.error(error);
    return buildLambdaResponse(context, error.statusCode || 500, { message: error.message });
  }
}