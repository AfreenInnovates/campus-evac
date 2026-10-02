#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CampusEvacStack } from "../lib/campusevac-stack";

const app = new cdk.App();

new CampusEvacStack(app, "CampusEvacStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:
      process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "ap-south-1",
  },
});
