"""
JustClarify API package.

.env is loaded here, before any submodule is imported, because several modules
read their configuration at import time. main.py imports `app.errata` and
`app.factcheck` near the top of the file and calls load_dotenv() further down —
so anything those modules read at module level would see an empty environment
and silently disable itself.

That failure is invisible in production, where Vercel supplies real environment
variables and load_dotenv() is a no-op. It only bites locally, which is exactly
where it costs the most time to diagnose. Putting it in __init__ makes the
ordering a property of the package rather than something every future module
has to remember.
"""

from dotenv import load_dotenv

load_dotenv()
