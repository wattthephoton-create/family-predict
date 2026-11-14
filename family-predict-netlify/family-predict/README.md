# FamilyPredict

A play-money prediction market for the family. The admin (you) decides which questions become real markets. Everyone else can propose questions and bet with pretend money. No real money, ever.

Family members do **not** need any accounts. They open your link, pick a name, and set a PIN.

## Put it online with Netlify (about 10 minutes, free)

You need a Netlify account and a GitHub account (you can sign in to Netlify with GitHub). There is no database to set up: bets are saved in Netlify's built-in storage (Netlify Blobs).

1. **Put these files on GitHub.**
   On github.com click **New repository**, name it `family-predict`, keep it private, then click **uploading an existing file** and drag in everything from this folder (the `netlify`, `public` and `server` folders, plus `netlify.toml`, `package.json` and `package-lock.json`). Click **Commit changes**.

2. **Deploy on Netlify.**
   On app.netlify.com click **Add new site > Import an existing project**, choose **GitHub**, pick the `family-predict` repository, and click **Deploy**. Leave all settings as they are (`netlify.toml` already tells Netlify what to do).

3. **Set your secret admin code.**
   In the site open **Site configuration > Environment variables**. Add a variable named `ADMIN_CODE` and make its value any password only you know. Save it.

4. **Redeploy.** Open **Deploys**, click **Trigger deploy > Deploy site** so step 3 takes effect.

5. **Become the admin.** Open your site (the `.netlify.app` address at the top of the site page), create your own account, tap your avatar at the top right, type your admin code under "Admin code", and tap **Unlock**. An **Admin** link appears and a star shows next to your name. Then send the link to the family.

### Without GitHub (for people comfortable with a terminal)

Dragging the folder onto Netlify in the browser is **not** enough: that only uploads the web page, not the part that saves bets. Use Netlify's command-line tool instead, from inside this folder:

```bash
npm install
```

```bash
npx netlify-cli deploy --prod
```

It asks you to log in and create a site the first time. Then do steps 3 to 5 above.

## How it works
- **Proposing:** anyone can open the **Propose** tab, write a question, and list options separated by commas (leave it as `Yes, No` for a simple yes/no, or use up to 6 options like `Dad, Mom, Grandma`). It goes to you for review.
- **Approving:** in the **Admin** tab you can edit a proposal, choose who decides the winner, set the house money, then approve it into a live market or decline it with a note. You can also create a market directly.
- **House money:** when a market is created the house puts in money (default $10) split evenly across all the options. Prices start equal and move as people bet. The house can never lose more than that amount.
- **Who decides the winner** (you pick per market):
  1. **The admin** decides.
  2. **The proposer** decides.
  3. **Players vote.** You close betting and open the vote, each player votes once, then you finalize and the most votes wins. Ties are refused so you can ask for a re-vote, or you can resolve it yourself.
  The admin can always override and resolve or void any market. Void refunds everyone.
- Tap your avatar at the top right to change your name or PIN, or to switch between dark and light mode. Everyone starts with $1,000.
- **Portfolio** shows your open bets and what they are worth. The search box and the Trending / New / Resolved tabs filter the markets.

## Notes
- The PIN is a casual lock that keeps family members out of each other's accounts. It is not bank-level security, so don't reuse a real PIN.
- With only $10 of house money, prices move fast: one $25 bet can push an option above 90%. If you want bets to move prices more gently, raise the house money when you approve a market (for example to $100).
- To add your own domain later: Netlify site > **Domain management**.
- To reset everything, open the site's **Blobs** page in Netlify, open the `family-predict` store, and delete the `state-v2` entry.
- This is a separate, family-only play-money game. It is not affiliated with Polymarket or any real prediction market.
