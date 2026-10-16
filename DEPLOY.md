# Deploying CampusEvac

A step-by-step guide to putting CampusEvac online on **Vercel**, with the AWS parts (Polly, DynamoDB, AppSync, SES) connected, and to checking it all works before we submit to the Amazon hackathon.

It takes about 30 minutes. You need:

- the **AWS account** that holds the `CampusEvacStack` (region `ap-south-1`, Mumbai);
- a **Vercel account** with access to the `AfreenInnovates/campus-evac` GitHub repo;
- the **Nebius Token Factory API key**. Get it from Akshay in a private message, never in a public channel or a file in the repo.

> **Keys never go in the repo.** Everything secret below goes into Vercel's environment-variable settings or your local `.env.local`, which git ignores. If a key is ever pasted somewhere public, delete it in its console and make a new one.

---

## Part 1: AWS

### 1.1 Check the realtime stack exists

The two-player drill rooms use an AppSync Events API and a DynamoDB table called `campusevac-events`, both created with the CDK. In the [CloudFormation console](https://ap-south-1.console.aws.amazon.com/cloudformation/home?region=ap-south-1), make sure the region at the top right is **Asia Pacific (Mumbai)** and look for a stack called **CampusEvacStack**.

- **It's there** (status `CREATE_COMPLETE` or `UPDATE_COMPLETE`): skip to 1.2.
- **It's not there:** deploy it from the repo, signed in to that account with the AWS CLI:

```bash
npm run infra:install
```

```bash
npm run infra:bootstrap
```

```bash
npm run infra:deploy
```

### 1.2 Note the stack's outputs

Open **CampusEvacStack → Outputs**. You need three values for Vercel later:

| Output | Goes into Vercel as |
| --- | --- |
| `HttpHost` | `NEXT_PUBLIC_EVENTS_HTTP_HOST` |
| `RealtimeEndpoint` | `NEXT_PUBLIC_EVENTS_REALTIME_URL` |
| `ApiKey` | `NEXT_PUBLIC_EVENTS_API_KEY` |

(If you have the repo on your machine and the AWS CLI signed in, `npm run env:pull` writes these three into `.env.local` for you.)

### 1.3 Create an IAM user for the website

The website's server needs its own AWS credentials, allowed to do only what the app does.

1. Open [IAM → Users](https://console.aws.amazon.com/iam/home#/users) → **Create user**. Name it `campusevac-vercel`. Don't give it console access.
2. On the permissions step, choose **Attach policies directly** and skip the list. After the user is created, open it → **Add permissions → Create inline policy → JSON**, paste the contents of [`infra/runtime-policy.json`](infra/runtime-policy.json), and save it as `campusevac-runtime`.
   - The policy names AWS account `851011315242`. If your account number (top right of the console) is different, change it in all three places in the JSON before saving.
   - It allows Polly speech, the DynamoDB table and SES email, and nothing else.
3. Open the user → **Security credentials → Create access key** → choose **Application running outside AWS**. Copy the **Access key ID** and **Secret access key** straight into Vercel (Part 2). The secret is shown only once.

### 1.4 Email sender (only for emailed drill reports)

Drill reports are sent from `afreenhossain0000@gmail.com`. In [SES → Identities](https://ap-south-1.console.aws.amazon.com/ses/home?region=ap-south-1#/identities), check that address is listed as **Verified**. If it isn't, click **Create identity → Email address**, enter it, and click the link SES emails you.

Skip this and everything else still works; reports just aren't emailed.

---

## Part 2: Vercel

### 2.1 Import the project

1. In Vercel, **Add New → Project** → import `AfreenInnovates/campus-evac`. Vercel detects **Next.js**; keep the default build settings.
2. In **Settings → General → Node.js Version**, choose **22.x** or **24.x**. The AI agent library needs Node 22 or newer, so the build fails on 20.

### 2.2 Environment variables

In **Settings → Environment Variables**, add each of these for the **Production** environment (and **Preview** if you want preview deploys to work too):

| Name | Value |
| --- | --- |
| `NEBIUS_API_KEY` | The Token Factory key from Akshay |
| `MCP_DRILL_KEY` | A long random password you make up, e.g. from a password generator. It stops strangers starting drills on our Nebius credits. The Echo page sends it automatically. |
| `MCP_DRILLS_PER_HOUR` | `6` |
| `WARDEN_ADMIN_KEY` | Another password you make up: who may retrain the shared AI warden |
| `AWS_ACCESS_KEY_ID` | From step 1.3 |
| `AWS_SECRET_ACCESS_KEY` | From step 1.3 |
| `AWS_REGION` | `ap-south-1` |
| `POLLY_REGION` | `ap-south-1` |
| `SES_REGION` | `ap-south-1` |
| `REPORTS_TABLE` | `campusevac-events` |
| `REPORT_FROM_EMAIL` | `afreenhossain0000@gmail.com` |
| `NEXT_PUBLIC_EVENTS_HTTP_HOST` | `HttpHost` from step 1.2 |
| `NEXT_PUBLIC_EVENTS_REALTIME_URL` | `RealtimeEndpoint` from step 1.2 |
| `NEXT_PUBLIC_EVENTS_API_KEY` | `ApiKey` from step 1.2 |

Two of these matter more than they look:

- **Set `AWS_REGION` yourself.** Vercel puts its own `AWS_REGION` (wherever its servers are) into the website's functions. Unless you set it to `ap-south-1`, the app looks for its table and Polly in the wrong region.
- **The `NEXT_PUBLIC_*` values are baked in when the site is built.** Set them before deploying, and redeploy whenever you change them.

### 2.3 Deploy

Click **Deploy** (or, if the project was already deployed, go to **Deployments → ⋯ → Redeploy**). **Any change to environment variables only takes effect after a redeploy.**

When it's done, note the site's address, e.g. `https://campus-evac.vercel.app`. The checks below call it `https://YOUR-SITE`.

> **If the build fails with an error about `maxDuration`:** the MCP route lets a fire drill keep running for up to 5 minutes (`maxDuration = 300`). On the Hobby plan this needs **Fluid compute**, which is on by default for new projects: check **Settings → Functions → Fluid Compute**. Send Akshay the error if that doesn't fix it.

---

## Part 3: Check it works

Do these in order. Each says what success looks like.

### Check 1: Polly speaks

```bash
curl -s -X POST https://YOUR-SITE/api/speak -H "content-type: application/json" -d '{"text":"Polly check","voice":"assistant"}' -o polly-check.mp3 -w "%{http_code} %{content_type}\n"
```

**Pass:** it prints `200 audio/mpeg`, and `polly-check.mp3` plays a voice saying "Polly check".

### Check 2: DynamoDB is reachable

```bash
curl -s https://YOUR-SITE/api/warden
```

**Pass:** a reply containing `"playbook"` and `"history"` (they can be empty).

### Check 3: the Echo page, end to end

This is the one the demo video is built on. Open `https://YOUR-SITE/echo` in **Chrome**.

1. Click **"I'm in the library and I smell smoke. Which way out?"**
   **Pass:** within a few seconds, directions out of the library, spoken in Polly's voice, with a purple **way out** chip under the answer. There should be no note saying Polly isn't reachable.
2. Click **🎙 Talk** and allow the microphone. Say *"What happens if a fire starts in the cafeteria?"*
   **Pass:** it hears you (your words appear under the ring), then says the drill has started, with a **start drill** chip.
3. Wait up to 4 minutes. **Pass:** the ring turns **yellow** with a chime.
4. Say or type *"How did the drill go?"*
   **Pass:** a real result: how many people got out, and who the plan let down.

### Check 4: drill rooms

1. Open `https://YOUR-SITE/simulation/rooms` → **Open room** → **Open drill**.
2. Click **Copy link**, open the link in a second tab and click **Join**.

**Pass:** both tabs show **2/2 seats** and a countdown.

### Check 5: strangers can't start drills

```bash
curl -s -X POST https://YOUR-SITE/api/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"start_drill","arguments":{"fire_room":"gym"}}}'
```

**Pass:** the reply says *"Starting drills needs this server's drill key."*

**All five pass?** Send Akshay the site address. It's ready for the submission and the demo video.

---

## If something fails

| What you see | Likely cause | Fix |
| --- | --- | --- |
| Check 1 or 2 says `Could not load credentials` | The AWS keys aren't reaching the site | Check `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set for **Production**, then **redeploy** |
| `AccessDenied` / `not authorized` | The inline policy is missing or names a different account | Redo step 1.3, checking the account number in the JSON |
| `ResourceNotFoundException` | Wrong region or table | `AWS_REGION` = `ap-south-1` and `REPORTS_TABLE` = `campusevac-events`, then redeploy |
| `The security token included in the request is invalid` | The access key is wrong, deleted, or mixed with Vercel's own AWS variables | Make a new access key (step 1.3), paste it again, redeploy. If it keeps happening, send Akshay the exact message. |
| Echo page: "Amazon Polly isn't reachable" | Check 1 failed | Fix check 1 first |
| Echo page answers with an error | `NEBIUS_API_KEY` missing or wrong | Set it, redeploy |
| Echo page: **Talk** does nothing or says the mic is blocked | Microphone permission denied | Click the lock icon in Chrome's address bar → allow the microphone → reload |
| Check 3, step 4: "no drill has been run" | The result was stored on a different server and DynamoDB isn't working | Fix check 2, then try again |
| Check 3: the ring never turns yellow (over 5 minutes) | Vercel stopped the drill at its time limit | Check **Fluid Compute** is on (Part 2.3), then tell Akshay |
| Check 4: "Connection" or "unavailable" | The `NEXT_PUBLIC_EVENTS_*` values are missing or wrong | Copy them again from step 1.2, redeploy |
| Check 5 starts a drill instead | `MCP_DRILL_KEY` isn't set | Set it, redeploy |

## Costs, for peace of mind

- **Nebius:** a fire drill costs a few cents. Each is capped at $0.50, and at most 6 can run an hour.
- **AWS:** Polly, DynamoDB, AppSync and SES at demo traffic fit within, or close to, their free tiers.
