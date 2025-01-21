import { Names } from "aws-cdk-lib";
import {
    AwsCustomResource,
    AwsCustomResourcePolicy,
    PhysicalResourceId,
    PhysicalResourceIdReference,
} from "aws-cdk-lib/custom-resources";
import { WAFV2 } from "aws-sdk";
import { Construct } from "constructs";

export interface WebAclProps {
    scope: "CLOUDFRONT" | "REGIONAL";
    region: string;
    account: string;
}

const wafManagedRules = [{
    Name: "AWS-AWSManagedRulesCommonRuleSet",
    Priority: 0,
    Statement: {
        ManagedRuleGroupStatement: {
            VendorName: "AWS",
            Name: "AWSManagedRulesCommonRuleSet",
            ExcludedRules: [],
        }
    },
    OverrideAction: {
        None: {}
    },
    VisibilityConfig: {
        CloudWatchMetricsEnabled: true,
        MetricName: "AWS-AWSManagedRulesCommonRuleSet",
        SampledRequestsEnabled: true
    }
}
]

/**
 * This construct creates a WAFv2 Web ACL for Cloudfront or AppSync in the appropriate region.
 */
export class WebAcl extends Construct {
    public readonly webAclId: string;
    public readonly webAclArn: string;
    public readonly name: string;

    constructor(scope: Construct, id: string, props: WebAclProps) {
        super(scope, id);

        this.name = `${id.substring(0, 40)}_${Names.uniqueId(this)}`;

        // The parameters for creating the Web ACL
        const createWebACLRequest: WAFV2.Types.CreateWebACLRequest = {
            Name: this.name,
            DefaultAction: { Allow: {} },
            Scope: props.scope,
            VisibilityConfig: {
                CloudWatchMetricsEnabled: true,
                MetricName: id,
                SampledRequestsEnabled: true,
            },
            Rules: wafManagedRules
        };


        // Create the Web ACL
        const createCustomResource = new AwsCustomResource(this, `Create`, {
            policy: AwsCustomResourcePolicy.fromSdkCalls({
                resources: AwsCustomResourcePolicy.ANY_RESOURCE,
            }),
            onCreate: {
                service: "WAFV2",
                action: "createWebACL",
                parameters: createWebACLRequest,
                region: props.region,
                physicalResourceId: PhysicalResourceId.fromResponse("Summary.Id"),
            },
        });
        this.webAclId = createCustomResource.getResponseField("Summary.Id");

        const getWebACLRequest: WAFV2.Types.GetWebACLRequest = {
            Name: this.name,
            Scope: props.scope,
            Id: this.webAclId,
        };

        // A second custom resource is used for managing the deletion of this construct, since both an Id and LockToken
        // are required for Web ACL Deletion
        new AwsCustomResource(this, `Delete`, {
            policy: AwsCustomResourcePolicy.fromSdkCalls({
                resources: AwsCustomResourcePolicy.ANY_RESOURCE,
            }),
            onCreate: {
                service: "WAFV2",
                action: "getWebACL",
                parameters: getWebACLRequest,
                region: props.region,
                physicalResourceId: PhysicalResourceId.fromResponse("LockToken"),
            },
            onDelete: {
                service: "WAFV2",
                action: "deleteWebACL",
                parameters: {
                    Name: this.name,
                    Scope: props.scope,
                    Id: this.webAclId,
                    LockToken: new PhysicalResourceIdReference(),
                },
                region: props.region,
            },
        });


        this.webAclArn = `arn:aws:wafv2:${props.region}:${props.account}:${props.scope === "CLOUDFRONT" ? "global" : "regional"
            }/webacl/${this.name}/${this.webAclId}`;


    }
}
