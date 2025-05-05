# Bluesky label scanner 🏷️ 🔍

This is the source code of my Label Scanner tool hosted as https://blue.mackuba.eu/scanner/. It lets you enter a Bluesky post URL or profile handle and see what moderation labels have been assigned to it (by Bluesky or third party labellers):

<p align="center"><img width="560" src="https://github.com/user-attachments/assets/874966e1-aa26-440f-98ea-6c0d30e86d3f"></p>

The tool is actually very simple, it's just some HTML and a couple of pages of JS. There isn't even any backend (apart from the JSON data with a list of labeller DIDs).

The trick is that the Bluesky AppView API includes all label info in JSON responses on endpoints like `getProfile`, `getPosts`, or `getPostThread`, related to up to 20 labellers that the user has opted in to. However, that list of labellers to apply labels from isn't something that is read from your account settings, but from a request header named `atproto-accept-labelers`.

So the scanner just takes the complete list of labeller DIDs, divides them into groups of 20, and runs multiple requests to e.g. `getProfile` for the same subject in parallel, each passing a different group of labellers in the header. Then, labels returned in all responses are combined together into the result list.


## Credits

Copyright © 2025 Kuba Suder ([@mackuba.eu](https://bsky.app/profile/mackuba.eu)).

The code is available under the terms of the [zlib license](https://choosealicense.com/licenses/zlib/) (permissive, similar to MIT).
