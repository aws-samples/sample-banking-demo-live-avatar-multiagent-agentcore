#!/bin/bash

POSITIONAL_ARGS=()
BOOTSTRAP_FILE="bootstrap-template.json"
POLICY_FILE="policy.json"
ROLE_NAME="gitlab-runner-role"
AWS_ACCOUNT=$(aws sts get-caller-identity --output text --query Account 2> /dev/null)
CURRENT_AWS_REGION=$(aws configure get region)
AWS_REGION=${CURRENT_AWS_REGION:-$DEFAULT_AWS_REGION}
git rev-parse --is-inside-work-tree >/dev/null 2>&1
if [[ $? -eq 0 ]]
then
  DEFAULT_GROUP=$(dirname `git config --get remote.origin.url` | awk -F: '{print $2}')
  DEFAULT_PROJECT=$(basename `git rev-parse --show-toplevel`)
fi

function print_help() {
  test -n "$1" && echo "Error: $1"
  echo "Usage: $(basename $0)"
  echo "    [--profile] Named profile. Defaults to value of AWS_PROFILE. Will be used to set Account and Region ($AWS_PROFILE)"
  echo "    -a|--account Account to configure. Defaults to account for current credentials ($AWS_ACCOUNT)"
  echo "    -r|--region Region to configure. Defaults to currently configured value ($AWS_REGION)"
  echo "    -g|--group Name of the GitLab group allowed to assume the role in your account ($DEFAULT_GROUP)"
  echo "    -p|--project Name of the GitLab project allowed to assume the role in your account ($DEFAULT_PROJECT)"
  echo "    -c|--cdk-policy-file The file that defines what GitLab can do in your account ($POLICY_FILE)"
  echo "    -b|--bootstrap-template Template to use as the bootstrap. If it does not exist, one will be generated($BOOTSTRAP_FILE)"
  echo "    [-n|--role-name] Name of the cross-account role to create and/or update ($ROLE_NAME)"
  echo "    [-h|--help] Print this help document"
  exit $2
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)
      AWS_PROFILE="$2"
      shift 2
      ;;
    -a|--account)
      export ACCOUNT="$2"
      shift 2
      ;;
    -r|--region)
      export REGION="$2"
      shift 2
      ;;
    -g|--group)
      GROUP="$2"
      shift 2
      ;;
    -p|--project)
      PROJECT="$2"
      shift 2
      ;;
    -c|--cdk-policy-file)
      POLICY_FILE="$2"
      shift 2
      ;;
    -b|--bootstrap-template)
      BOOTSTRAP_FILE="$2"
      shift 2
      ;;
    -n|--role-name)
      ROLE_NAME="$2"
      shift 2
      ;;
    -h|--help)
      print_help "" 0
      ;;
    -*|--*)
      echo "Unknown option $1"
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1") # save positional arg
      shift # past argument
      ;;
  esac
done

set -- "${POSITIONAL_ARGS[@]}" # restore positional parameters

PROFILE=""
if [[ ! -z "${AWS_PROFILE}" ]]
then
  PROFILE="--profile $AWS_PROFILE"
fi

if [[ -z "$ACCOUNT" ]]
then
  read -p "Enter the AWS Account ID you want to use [$AWS_ACCOUNT]:" account
  export ACCOUNT=${account:-$AWS_ACCOUNT}
  test "$ACCOUNT" || print_help "You must specify an account number" 1
else
  echo "Account: $ACCOUNT"
fi
if [[ -z "$REGION" ]]
then
  read -p "Enter the region you want to use [$AWS_REGION]:" region
  export REGION=${region:-$AWS_REGION}
  test "$REGION" || print_help "You must specify a region" 1
else
  echo "Region: $REGION"
fi
if [[ -z "$GROUP" ]]
then
    read -p "Enter the name of the Gitlab group you want to use [$DEFAULT_GROUP]:" group
    GROUP=${group:-$DEFAULT_GROUP}
    test "$GROUP" || print_help "You must specify a GitLab group name" 1
else
  echo "GitLab Group: $GROUP"
fi
if [[ -z "$PROJECT" ]]
then
    read -p "Enter the name of the Gitlab project you want to use [$DEFAULT_PROJECT]:" project
    PROJECT=${project:-$DEFAULT_PROJECT}
    test "$PROJECT" || print_help "You must specify a GitLab project name" 1
else
  echo "GitLab Project: $PROJECT"
fi

echo "Checking file"
test -f "$POLICY_FILE" || print_help "$POLICY_FILE does not exist. You must specify a path to a policy for the $ROLE_NAME role" 1

# Set up the default policy statement given the Gitlab repo
read -r -d '' POLICY_STATEMENT <<EOF
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::979517299116:role/gitlab-runners-prod"
      },
      "Action": [
        "sts:AssumeRole",
        "sts:TagSession"
      ],
      "Condition": {
        "StringEquals": {
          "aws:PrincipalTag/GitLab:Group": "$GROUP",
          "aws:PrincipalTag/GitLab:Project": "$PROJECT"
        }
      }
    }
EOF
read -r -d '' DEFAULT_ASSUME_POLICY <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    $POLICY_STATEMENT
  ]
}
EOF
# Note - only ACCOUNT and REGION are exported, so only they are available
# If your policy requires other variables, export them as well
CDK_ROLES_POLICY=$(envsubst < $POLICY_FILE)
ROLE_ARN="arn:aws:iam::$ACCOUNT:role/$ROLE_NAME"
ROLES_TO_UPDATE=(FilePublishingRole ImagePublishingRole LookupRole DeploymentActionRole)
ROLE_RESOURCES=$(for r in ${ROLES_TO_UPDATE[@]}; do echo ".Resources.${r}.Properties.AssumeRolePolicyDocument.Statement"; done)
ROLE_RESOURCES=$(echo $ROLE_RESOURCES | sed 's/ /, /g')
read -r -d '' BOOTSTRAP_SNIPPET <<EOF
{
  "Action": [ "sts:AssumeRole", "sts:TagSession" ],
  "Effect": "Allow",
  "Principal": {
    "AWS": {
      "Fn::Sub": "$ROLE_ARN"
    }
  }
}
EOF
echo "Getting current CDK Bootstrap template..."
if [[ -f "$BOOTSTRAP_FILE" ]]
then
  TEMPLATE=$(cat "$BOOTSTRAP_FILE")
else
  TEMPLATE=$(cdk bootstrap --show-template --json 2>/dev/null)
fi
echo "Updating to allow GitLab to assume roles"
jq -r "($ROLE_RESOURCES) |= (. + [$BOOTSTRAP_SNIPPET] | unique)" <<< $TEMPLATE > "$BOOTSTRAP_FILE"
ROLE=$(aws iam get-role --role-name "$ROLE_NAME" 2>/dev/null)

if [ $? -eq 0 ]
then
  OLD_POLICY=$(jq ".Role.AssumeRolePolicyDocument" <<<$ROLE)
  NEW_POLICY=$(jq ".Statement |= (. + [$POLICY_STATEMENT] | unique)" <<<$OLD_POLICY)
  echo "Updating trust policy for $ROLE_NAME to allow $GROUP/$PROJECT"
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "$NEW_POLICY" >/dev/null 2>&1
  aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "gitlab-cdk-$REGION" \
    --policy-document "$CDK_ROLES_POLICY" >/dev/null 2>&1
else
  echo "Creating Role $ROLE_NAME to allow $GROUP/$PROJECT"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$DEFAULT_ASSUME_POLICY" >/dev/null 2>&1
  aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "gitlab-cdk-$REGION" \
    --policy-document "$CDK_ROLES_POLICY" >/dev/null 2>&1
fi
cdk bootstrap aws://$ACCOUNT/$REGION --template bootstrap-template.json $PROFILE --force
