---
name: setup
description: Set up Context7 Admin after installing the plugin, or when the user asks what it can do: sign in, pick a teamspace, and show its usage, libraries, Docs7 and Ask sites. Use for "set up Context7", "connect my Context7 account" or "what can Context7 Admin do". Do not use for documentation lookups (that is the Context7 docs plugin).
---

# Set up Context7 Admin

The user's own words come first: if they ask for one thing, do that and skip the rest.

1. Call `list_teamspaces`. If the call asks for sign-in, tell the user to finish the Context7 sign-in in the browser window, then call it again.
2. If there is more than one teamspace, list them by name with the user's role and ask which one to use. Keep its id for the next calls. Do not choose for the user.
3. Call `open_console` with that `teamspace`. In a client that shows apps, the user now sees a summary card that they can open as the full console. Do not repeat its numbers.
4. In a client that shows no app (a terminal), call `get_teamspace` instead and give the plan, the role and this month's spend in two or three lines.
5. Offer up to three next steps that fit the teamspace, for example:
   - "Improve the docs of <library> from its benchmark questions" (a library the teamspace owns).
   - "Fix the last failed build of <Docs7 site>".
   - "Add an Ask site for <your site URL>".

Stop after the offer. Do not change any setting during setup.
