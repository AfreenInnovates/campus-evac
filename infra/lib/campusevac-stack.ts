import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { aws_appsync as appsync, aws_dynamodb as dynamodb } from "aws-cdk-lib";
import { Construct } from "constructs";

export const EVENTS_TABLE = "campusevac-events";

/**
 * Realtime backbone: one AppSync Events API with two channel namespaces.
 *   /live/{code}/pos    runner transform ~10 Hz, broadcast only, never stored
 *   /game/{code}/{kind} lobby, pings, interventions, outcome; saved to DynamoDB
 */
export class CampusEvacStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "Events", {
      tableName: EVENTS_TABLE,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiKey = { authorizationType: appsync.AppSyncAuthorizationType.API_KEY };
    const api = new appsync.EventApi(this, "Realtime", {
      apiName: "campusevac-realtime",
      authorizationConfig: {
        authProviders: [
          {
            ...apiKey,
            apiKeyConfig: {
              name: "game",
              expires: cdk.Expiration.after(cdk.Duration.days(365)),
            },
          },
        ],
      },
    });

    api.addChannelNamespace("live");

    const store = api.addDynamoDbDataSource("EventStore", table);
    api.addChannelNamespace("game", {
      code: appsync.Code.fromAsset(path.join(__dirname, "../src/game-handler.js")),
      publishHandlerConfig: { dataSource: store },
    });

    new cdk.CfnOutput(this, "HttpEndpoint", { value: `https://${api.httpDns}/event` });
    new cdk.CfnOutput(this, "RealtimeEndpoint", { value: `wss://${api.realtimeDns}/event/realtime` });
    new cdk.CfnOutput(this, "HttpHost", { value: api.httpDns });
    new cdk.CfnOutput(this, "ApiKey", { value: api.apiKeys.game.attrApiKey });
    new cdk.CfnOutput(this, "EventsTable", { value: table.tableName });
  }
}
