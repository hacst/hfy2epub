# hfy2epub

hfy2epub is web-tool to turn post series from [reddit.com/r/HFY](https://www.reddit.com/r/HFY/) into EPUB files for easy offline consumption with a reader or text-to-speech.

All work to identify the posts, fetch them and turn them into an epub are performed in the browser with no server component required.

## Features
* Can retrieve series information from HFY wiki pages or by following the next links starting from an initial post
* Supports NSFW tagged posts
* Completely in-browser. No installation required. No data transmitted to or from server.
* Should work in all modern browsers

## Usage
Before you do anything with this tool be aware that you must not distribute the epub files created by this tool if the author has not given you permission to do so. In general respect the author's wishes and do not use this tool if the author is not ok with it. When in doubt ask the author.

With that out of the way using hfy2epub is quite straight-forward. After opening [index.html](https://hacst.net/hfy2epub/index.html) in your browser all you need is the URL of a HFY wiki page listing the parts of a series or the first post of a series that links to future posts with next links.

After providing that URL press the "Retrieve series info". This will try to populate title, author as well as the list of parts in the "Series information" section. Review the information and correct as needed.

Once that is completed press the "Download EPUB" button and the tool will fetch any posts not already retrieved, create the EPUB and trigger the download to you. 

## Limitations
This tool has no ambitions to do everything for everyone. Series information detection is based on a some very weak heuristics like links with specific names being present, titles being set in a specific way and so on. It will not work for everything and everyone.

Also this tool makes no attempt to create an especially pretty EPUB. It simply slaps the HTML of first post of each detected part of the series into the EPUB. It is meant for reading not distribution.

