# Google Drive Build Warning

Note: `npm run build` (and other intensive node_modules operations) may fail when run directly on Google Drive mirrored folders due to file locking, path length limits, or synchronisation conflicts.

It is recommended to:
1. Copy the project to a local directory (e.g., `C:\projects\`) to perform builds or heavy development.
2. Use Vercel's Git integration if possible, by pushing to GitHub/GitLab/Bitbucket.
3. If using Vercel CLI, try running from a local path if the Drive path causes issues.
