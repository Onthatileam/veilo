# Veilo — Real-time Field Team Tracker

## Quick Start (Local)

1. **Install dependencies**
   ```
   npm install
   ```

2. **Start the server**
   ```
   npm start
   ```

3. **Open your browser**
   ```
   http://localhost:3000
   ```

4. **Demo login**
   - Email: demo@veilo.app
   - Password: demo1234

## Pages
- `/` — Landing page
- `/register` — Sign up
- `/login` — Sign in
- `/dashboard` — Owner live map dashboard
- `/track/:token` — Worker tracking page (mobile)
- `/pricing` — Pricing page

## How to test end-to-end
1. Register an account
2. Go to Dashboard → Add a worker
3. Copy the tracking link
4. Open the tracking link on your phone (or another browser tab)
5. Press "Start sharing location"
6. Watch the pin appear on your dashboard map in real time

## Deploy to Railway
1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Set environment variable: SESSION_SECRET=any-random-string
4. Railway auto-detects Node.js and deploys

## File structure
```
veilo/
├── server.js          # Main server + all routes + socket.io
├── package.json
├── .env
├── data/
│   └── db.json        # Auto-created file-based database
├── views/
│   ├── landing.html   # Marketing homepage
│   ├── login.html     # Login page
│   ├── register.html  # Sign up page
│   ├── dashboard.html # Owner live map
│   ├── tracker.html   # Worker tracking page (mobile)
│   └── pricing.html   # Pricing page
└── public/            # Static assets folder
```
