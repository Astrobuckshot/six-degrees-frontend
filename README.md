# Six Degrees - Frontend (v1, bare functional)

This is the first working version of the site: two search boxes, a
"Find Connection" button, and a plain text result showing the shortest
path. No bubbles/photos/styling polish yet - that comes later once this
core version is confirmed working end to end.

## What's in here

- `src/App.jsx` - the React page itself
- `src/App.css` - minimal styling
- `api/search-people.js` - serverless function powering the search boxes
- `api/find-path.js` - serverless function that finds the shortest path
  (same logic as find_path.py, ported to JavaScript)

## Local setup

1. `npm install`
2. Copy `.env.example` to a new file called `.env.local`, and fill in
   your real Supabase URL and Publishable key (same values you've used
   in the Python scripts).
3. `npm run dev` - this runs the React app, but note: the search boxes
   won't work yet this way, because `/api` functions need Vercel to run
   them, not plain Vite. This is fine for checking that the page LOOKS
   right, just not for testing the actual search.

## Testing the full thing (including search)

The easiest way to test everything for real, including the API
functions, is to deploy to Vercel and test on the live URL - same
rhythm as pushing to GitHub for the GLOW site, just with a new
platform (Vercel) instead of GitHub Pages, because GitHub Pages can't
run the serverless search functions.

See the setup walkthrough for:
1. Creating a Vercel account and connecting it to a new GitHub repo
   for this project
2. Adding SUPABASE_URL and SUPABASE_KEY as Environment Variables in
   the Vercel project settings (NOT committed to GitHub - this is
   Vercel's equivalent of your .env.local, just for the live site)
3. Pushing code - Vercel auto-deploys, same as GitHub Actions did for
   GLOW

## Known limitations of this v1 (expected, not bugs)

- Each search takes a few seconds, since the search function downloads
  the whole database fresh every time (mirrors how find_path.py works
  today). A future optimization would move the search logic directly
  into Supabase so this isn't necessary.
- No photos (photo_url isn't populated in the database yet)
- No bubble/visual layout yet - just a simple vertical list
