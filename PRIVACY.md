# Privacy Policy for Kauri

Kauri is a local-only decision record tool. It does not collect, transmit, or process any data on external servers.

## Data Storage

- **Project-scoped records** are stored in `.kauri/store.db` within your repository
- **User-scoped records** are stored in `~/.kauri/store.db` on your local machine

## No Data Collection

- No analytics or telemetry
- No user accounts or authentication
- No cookies or tracking
- No network requests to external servers

## Version Control

Project-scoped records (`.kauri/store.db`) are designed to be committed to your repository. If you push to a remote (e.g., GitHub, GitLab), those records will be shared according to your repository's visibility and access settings.

User-scoped records (`~/.kauri/store.db`) remain on your local machine unless you explicitly copy or share them.

## Your Responsibility

You control what gets committed and pushed through your normal git workflow. Kauri does not automatically sync or upload any data.

---

Last updated: April 2026
