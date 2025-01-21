import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
import { Stack } from "aws-cdk-lib";
import { CDKProps } from "../config/AppConfig";

interface WafRule {
    Rule: wafv2.CfnWebACL.RuleProperty;
}

const awsManagedRules: WafRule[] = [
    {
        Rule: {
            name: "IPRateLimitingRule",
            priority: 0,
            statement: {
                rateBasedStatement: {
                    limit: 3000,
                    aggregateKeyType: "IP",
                },
            },
            action: {
                block: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "IPRateLimitingRule",
            },
        },
    },
    {
        Rule: {
            name: "AWS-AWSManagedRulesCommonRuleSet",
            priority: 1,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesCommonRuleSet",

                },
            },
            overrideAction: {
                count: {}, // override to count to bypass AWS#AWSManagedRulesCommonRuleSet#SizeRestrictions_BODY
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesCommonRuleSet",
            },
        },
    },
    {
        Rule: {
            name: "AWS-AWSManagedRulesBotControlRuleSet",
            priority: 2,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesBotControlRuleSet",
                    ruleActionOverrides: [
                        // to allow requests from POSTMAN/ CURL to APPSYNC
                        // this may allow true positives and not recommended 
                        {
                            actionToUse: {
                                count: {},
                            },
                            name: "CategoryHttpLibrary"
                        },
                        {
                            actionToUse: {
                                count: {},
                            },
                            name: "SignalNonBrowserUserAgent"
                        },
                    ],
                    excludedRules: []


                },
            },

            overrideAction: {
                none: {}
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesBotControlRuleSet",
            },


        },
    },
    {
        Rule: {
            name: "AWS-AWSManagedRulesWordPressRuleSet",
            priority: 3,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesWordPressRuleSet",
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesWordPressRuleSet",
            },
        },
    },
    {
        Rule: {
            name: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
            priority: 4,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesKnownBadInputsRuleSet",
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
            },
        },
    },
    {
        Rule: {
            name: "AWS-AWSManagedRulesUnixRuleSet",
            priority: 5,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesUnixRuleSet",
                    excludedRules: [
                        {
                            name: "UNIXShellCommandsVariables_BODY",
                        },
                    ],
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesUnixRuleSet",
            },
        },
    },
    {
        Rule: {
            name: "AWS-AWSManagedRulesSQLiRuleSet",
            priority: 6,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesSQLiRuleSet",
                    excludedRules: [
                        {
                            name: "SQLi_BODY",
                        },
                    ],
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesSQLiRuleSet",
            },
        },
    },

];
export class WAFStack extends Stack {
    public readonly regionalWebAcl: wafv2.CfnWebACL
    constructor(scope: Construct, id: string, props: CDKProps) {
        super(scope, id, props);

        this.regionalWebAcl = new wafv2.CfnWebACL(this, `${props.projectName}-regional-waf`, {
            name: `${props.projectName}-regional-waf`,
            defaultAction: { allow: {} },
            scope: "REGIONAL",
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: `${props.projectName}-regional-waf-metric`,
                sampledRequestsEnabled: true,
            },
            rules: awsManagedRules.map((wafRule) => wafRule.Rule),
        });
    }
}