// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { NestedStack, NestedStackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export interface DatabaseStackProps extends NestedStackProps {
  readonly cdkAppName: string;
}

export class DemoDatabaseStack extends NestedStack {
  public readonly demoTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // Create the DemoTable
    this.demoTable = new dynamodb.Table(this, "DemoTable", {
        tableName: `${props.cdkAppName}-DemoTable`,
        partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
        pointInTimeRecovery: true, // Enable Point-in-Time Recovery
        encryption: dynamodb.TableEncryption.AWS_MANAGED, // Enable encryption
        timeToLiveAttribute: "ExpirationTime", // Enable Time-to-Live
      });

    new CfnOutput(this, "demoTableName", {
        key: 'demoTableName',
        value: this.demoTable.tableName
      });
  }
}