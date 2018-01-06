'use strict';

var requestRedditJsonCache = new Map();
var timeOfLastRealRequest = 0;
var timeInMsBetweenRequests = 2000; // Don't hammer the API

// These authors have stated that they do not want their posts
// to be turned into EPUBs. Please respect their wishes and do
// not remove the blacklisting code
var authorBlacklist = [
];

// The authors of these posts have stated that they do not want
// this post to be turned into an EPUB. Please respect their wishes
// and do not remove the blacklisting code
var postNameBlacklist = [
];

// Authors can add this string to title or content of their posts
// to state that they do not want it turned into an EPUB. Please
// respect their wishes and do not remove the blacklisting code
var blacklistTag = "[NOEPUB]";

// Attempts to retrieve the given reddit URL in json. For this it appends .json to the url
//  If successful calls successCallback with the JSON object of the page
//  If the request fails errorCallback is called with an error string describing the failure
function requestRedditJSON(url, successCallback, errorCallback)
{
    setTimeout(function() {
        var httpRequest = new XMLHttpRequest();
        httpRequest.onreadystatechange = function () {
            timeOfLastRealRequest = Date.now();
            if (httpRequest.readyState === XMLHttpRequest.DONE) {
                if (httpRequest.status === 200) {
                    console.debug("retrieved " + url);
                    var json = JSON.parse(httpRequest.responseText);
                    successCallback(json);
                }
                else {
                    var err = "Failed to retrieve url '" + url + "' (" + httpRequest.statusText + ")";
                    console.error(err, httpRequest);
                    errorCallback(err);
                }
            }
        };
        httpRequest.open('GET', url + '.json', true); // Retrieve in JSON format for CORS and NSFW compat
        httpRequest.send();
    }, Math.max(0, timeOfLastRealRequest + timeInMsBetweenRequests - Date.now()));
}


// Calls requestRedditJSON and caches its results for future calls if the request succeeds.
function requestRedditJSONCached(url, successCallback, errorCallback)
{
    if (requestRedditJsonCache.has(url)) {
        successCallback(requestRedditJsonCache.get(url));
    } else {
        requestRedditJSON(url, function(json) {
            requestRedditJsonCache.set(url, json);
            successCallback(json);
        }, errorCallback);
    }
}

// Returns true if the given URL was cached by requestRedditJSONCached
function isCached(url) {
    return requestRedditJsonCache.has(url);
}

// Expects a HFY wiki page url and heuristically attempts to extract series information.
//  If successful calls completionCallback with a series object of the structure
//      {title:string, author:string, parts:[part]}
//  If the information collection fails errorCallback is called with a string describing the failure.
function collectSeriesInfoFromWikiPage(url, completionCallback, errorCallback)
{
    requestRedditJSONCached(url, function(json) {
        if (json.kind != "wikipage") errorCallback(url + " is not a wiki page");
        var indexHtml = he.decode(json.data.content_html);

        var parser = new DOMParser();
        var doc = parser.parseFromString(indexHtml, "text/html");

        // Try to guess title
        var title = "";
        var h1 = doc.getElementsByTagName("h1");
        if (h1.length > 0) {
            title = h1[0].textContent;
        } else {
            var h2 = doc.getElementsByTagName("h2");
            if (h2.length > 0) {
                title = h2[0].textContent;
            } else {
                var h3 = doc.getElementsByTagName("h3");
                if (h3.length > 0) {
                    title = h3[0].textContent;
                }
            }
        }

        // Try to find parts
        var parts = [];
        var links = doc.getElementsByTagName("a");
        for (var i = 0; i < links.length; i++) {
            //TODO: Could also try to guess the author name here
            var link = links[i];
            var name = nameFromURL(link.getAttribute('href'));
            if (name) {
                // We assume everything we can get a name for is fair game
                parts.push({
                    name: name,
                    url: link.getAttribute('href'),
                    title: link.textContent
                });
            }
        }

        // Find author information from first part post
        if (parts.length > 0) {
            collectPost(parts[0].url, function(post) {
                completionCallback({
                    title: title == "" ? post.title : title,
                    author: post.author,
                    parts: parts
                });
            },
            errorCallback);
        }
    }, errorCallback);
}

// Given the HTML content of a post and a set of previous reddit post names attempts to
// heuristically find the URL of the next post. It does so by checking each link text
// of the post against a regex it retrieves from a UI input element #nextPostRegex .
// The first match it finds is returned as the next URL. If no match is found null is
// returned.
function findNextURL(content, previousNames) {
    var parser = new DOMParser();
    var regex = new RegExp(document.getElementById("nextPostRegex").value, "i");
    var doc = parser.parseFromString(content, "text/html");
    var links = doc.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
        var link = links[i];
        if (link.textContent.match(regex)) {
            var potentialNextLink = link.getAttribute('href');
            if (!previousNames.includes(nameFromURL(potentialNextLink))) {
                return potentialNextLink;
            }
        }
    }
    return null;
}

// Returns the reddit name for a given url
// The URL may be shortened.
// Full URLs may miss the reddit.com prefix and may refer to a comment
function nameFromURL(url)
{
    var match = url.match(/redd\.it\/([A-Za-z0-9]+)/i); // Shortened
    if (match) {
        return match[1].toLowerCase();
    }
    match = url.match(/r\/HFY\/comments\/([A-Za-z0-9]+)(?:\/\w*(\/[A-Za-z0-9]+))?/i);
    if (match) {
        var name = match[1].toLowerCase();
        if (match[2]) {
            name += "/" + match[2].toLowerCase(); // This is a nested name referring to a comment.
        }
        return name;
    }
    return undefined;
}

// Returns the reddit url for a given reddit post name.
// Only works for HFY posts.
function urlFromName(name)
{
    return "https://www.reddit.com/r/HFY/comments/" + name + "/";
}

// Returns true if the given reddit post name was cached by requestRedditJSON already
function isNameCached(name) {
    return isCached(urlFromName(name));
}

// Returns true if the link points to the HFY wiki
function isWikiLink(url) {
    return !!url.match(/r\/HFY\/wiki/i);
}

// Due to CORS we cannot work with shortened URI. Luckily reddits URL shortener is special
// so as long as we know the subreddit we are working with we can unshorten ourselves.
// This function also normalizes the name to improve caching
function unshorten(url)
{
    if (!isWikiLink(url)) {
        return urlFromName(nameFromURL(url));
    } else {
        // Cannot normalize wiki links so just make sure they are https
        return url.replace(/^http:\/\//i, 'https://');
    }
}

// Given a post and child data for it heuristically tries to determine whether the author
// continue the story in the comments.
// - If no error occurs successCallback is called with the concatenated html content of the
//   presumed continuation chain as a string.
// - If an error occurs errorCallback is called with a string describing the fault.
function collectPostContentInComments(post, children, successCallback, errorCallback) {
    // This function implements a basic heuristic for identifying content containing comment chains
    var isContentComment = function(comment, depthOffset) {
        var authorReplyingToHimself = comment.depth + depthOffset > 1; // Either author talks to himself or this is a chain
        var contentIsKindaLengthy = comment.body_html.length > 2048; // Author might be long winded or this is a chain

        return authorReplyingToHimself || contentIsKindaLengthy;
    };

    var collectPostAuthorContentRecurse = function(comments, relativeParentPermalink, depth, contentCallback) {
        for (var i = 0; i < comments.length; ++i) {
            if (comments[i].kind == "more" && comments[i].data.id == "_") {
                console.log("Depth limit exceeded. Need to fetch " + relativeParentPermalink + " to continue.");
                var parentPermalink = unshorten(relativeParentPermalink);
                requestRedditJSONCached(parentPermalink, function(json) {
                    var moreChildren = json[1].data.children[0].data.replies.data.children;
                    collectPostAuthorContentRecurse(moreChildren, relativeParentPermalink, comments[i].data.depth, contentCallback);
                }, errorCallback);
                return;
            } else {
                var comment = comments[i].data;
                if (comment.author == post.author && isContentComment(comment, depth)) {
                    console.log("Found content in #" + i + " comment " + comment.name + " in depth " + (depth + comment.depth) + " with " + comment.body_html.length + " length.")
                    var content = he.decode(comment.body_html);
                    if (comment.replies) {
                        collectPostAuthorContentRecurse(comment.replies.data.children, comment.permalink, depth, function (additionalContent) {
                            contentCallback(content + additionalContent);
                        });
                    } else {
                        contentCallback(content);
                    }
                    return;
                }
            }
        }
        contentCallback("");
    };

    collectPostAuthorContentRecurse(children, post.permalink, 0, successCallback);
}

// Given the URL to a reddit HFY post retrieves this function retrieves it.
// - If successful successCallback is called with a post object of the following
//   structure {author:string, title:string, name:string, content:string, url:string}.
//   Where author is the author of the post page, title is the title of the post, name is
//   the reddit name of the post, content is the HTML content of the initial post and url is
//   url of the post.
// - If the collection fails errorCallback is called with a string describing the failure.
function collectPost(url, successCallback, errorCallback)
{
    var unshortenedUrl = unshorten(url);

    if (postNameBlacklist.indexOf(nameFromURL(unshortenedUrl)) > -1) {
        errorCallback("The author of '" + unshortenedUrl + "' requested that this post should not be processed with this tool.");
        return;
    }

    requestRedditJSONCached(unshortenedUrl, function(json) {
        var post = json[0].data.children[0].data; // Post data
        var children = json[1].data.children;

        if (authorBlacklist.indexOf(post.author.toLowerCase()) > -1) {
            errorCallback("The author of '" + post.url + "' requested that his posts should not be processed with this tool.");
            return;
        }

        var content = he.decode(post.selftext_html);

        if (post.title.indexOf(blacklistTag) > -1 || content.indexOf(blacklistTag) > -1) {
            errorCallback("The author of '" + unshortenedUrl + "' marked this post with " + blacklistTag + ". This tool will not process post with this tag.");
            return;
        }

        collectPostContentInComments(post, children,
            function(comment_content) {
                var collectedPost = {
                    author: post.author,
                    title: post.title,
                    name: post.name,
                    content: content + comment_content,
                    url: post.url
                };
                successCallback(collectedPost);
            },
            errorCallback
        );

    }, errorCallback);
}

// Given a list of parts of the structure {title:string, url:string} collects
// the posts for each part by calling collectPost for its URL. The given part
// title takes precedence of the title of the collected post.
// The function also takes a dictionary of callbacks.
// - Each time a post is collected callbacks.collectPost will be called with the
//   newly collected post.
// - Once all parts are collected callbacks.done is called with the list of all
//   collected posts.
// - If an error occurs callbacks.error is called with an object of structure
//   {part:part, message:string} identifying the part and which error occurred.
//   Collection is aborted after any error.
//
// If any of the callbacks returns false the collection is aborted.
function collectPartPosts(parts, callbacks)
{
    var posts = [];
    var collectPart = function(i) {
        if (i >= parts.length) {
            if (callbacks.done) {
                if (callbacks.done(posts) === false) return;
            }
        } else {
            var part = parts[i];
            collectPost(part.url, function(post) {
                post.title = part.title; // Take title from listing
                if (callbacks.collectedPost) {
                    if (callbacks.collectedPost(post) === false) return;
                }
                posts.push(post);
                collectPart(i + 1);
            }, function(error) {
                if (callbacks.error) {
                    callbacks.error({message: error, part: part});
                }
            });
        }
    };

    collectPart(0);
}

// Follows a series of posts from a starting post
//
// Callbacks:
//  foundUrl(url)
//  collectedPost(post)
//  error(error)
//  done([post])
//
// Any callback returning false aborts the find operation
function findSeriesParts(startUrl, callbacks) {
    var collectedPosts = [];
    var previousNames = [];
    var collectPostRecurse = function(url) {
        // Retrieve the page
        console.log("collectPostRecurse " + url);
        collectPost(url, function(collectedPost) {
            collectedPosts.push(collectedPost);
            if (callbacks.collectedPost) {
                if (callbacks.collectedPost(collectedPost) === false) return;
            }
            previousNames.push(nameFromURL(url));
            var nextUrl = findNextURL(collectedPost.content, previousNames);
            if (nextUrl) {
                if (callbacks.foundUrl) {
                    if (callbacks.foundUrl(nextUrl) === false) return;
                }
                console.log("scheduling collection of '" + nextUrl + "'");
                collectPostRecurse(nextUrl);
            } else {
                console.log("Collection from " + url + " complete. Found " + collectedPosts.length + " posts in series");
                if (callbacks.done) {
                    if (callbacks.done(collectedPosts) === false) return;
                }
            }
        }, function(error) {
            console.log(error);
            log("Failed at post '" + url + "': " + error, "error");
            if (callbacks.error) {
                if (callbacks.error(error) === false) return;
            }
        });
    };
    collectPostRecurse(startUrl);
}

// Creates a new entry in the user visible list of logs.
// Level can be any css class like success, warning or danger that
// should be applied to the log entry.
function log(html, level)
{
    var levelClass = level ? ('list-group-item-' + level) : '';
    var log = document.getElementById("logList");
    log.innerHTML += '<li class="list-group-item ' + levelClass + '">' + html + '</li>';
}

// Return the user provided start URL
function getStartUrl()
{
    return document.getElementById("startUrl").value;
}

// Update the given table row with either "success", "warning" or "danger" state
// removing all other states.
function updateRowState(row, state) {
    row.classList.remove("danger");
    row.classList.remove("warning");
    row.classList.remove("success");

    if (state == "success") row.classList.add("success");
    else if (state == "warning") row.classList.add("warning");
    else if (state == "danger") row.classList.add("danger");
}

// Given a part object of structure {title:string, url:string} creates
// a new row in the #partsrow-table. This is done by copying the
// .partsrow-template row and adjusting its cells accordingly.
function addPartToList(part)
{
    var tbody = document.querySelector("#partsrow-table tbody");

    var template = tbody.querySelector(".partsrow-template");
    var instance = template.cloneNode(true);
    instance.classList.remove("partsrow-template");

    instance.querySelector(".partsrow-title").textContent = part.title;
    var url = instance.querySelector(".partsrow-url");
    url.textContent = part.url;

    var link = instance.querySelector(".partsrow-link a");
    var updateLink = function () {
        updateRowState(instance, isNameCached(nameFromURL(url.textContent)) ? "success" : "none");
        link.setAttribute("href", url.textContent);
    };
    url.addEventListener("input", updateLink);

    var removeBtn = instance.querySelector(".partsrow-remove .partsrow-remove-btn");
    removeBtn.addEventListener("click", function() {
       instance.remove();
    });

    updateLink();

    tbody.appendChild(instance);

    instance.scrollIntoView(false);
}

// Given a part object of structure {title:string, url:string} either
// creates a new row in the #partsrow-table or updates the existing
// one with the given URL.
function addOrUpdatePartInList(part)
{
    var row = getRowForPart(part.url);
    if (!row) {
        addPartToList(part);
    } else {
        row.querySelector(".partsrow-title").textContent = part.title;
        updateRowState(row, isNameCached(nameFromURL(part.url)) ? "success" : "none");
        row.scrollIntoView(false);
    }
}

// Given the URL of a reddit HFY post returns the corresponding tr DOM element
// in the #partsrow-table. Returns null if no row exists for the URL.
function getRowForPart(url) {
    var name = nameFromURL(url);
    var rows = document.querySelectorAll("#partsrow-table tbody tr:not(.partsrow-template)");
    for (var i = 0; i < rows.length; ++i) {
        var row = rows[i];
        var rowUrl = row.querySelector(".partsrow-url").textContent;
        var rowName = nameFromURL(rowUrl);
        if (name == rowName) {
            return row;
        }
    }
    return null;
}

// Returns a part list of structure [{name:string, title:string, url:string}] with one
// entry for each row of the #partsrow-table.
function getPartsFromList()
{
    var parts = [];
    var rows = document.querySelectorAll("#partsrow-table tbody tr:not(.partsrow-template)");
    for (var i = 0; i < rows.length; ++i) {
        var row = rows[i];
        var title = row.querySelector(".partsrow-title").textContent;
        var url = row.querySelector(".partsrow-url").textContent;

        parts.push({
            name: nameFromURL(url),
            title: title,
            url: url
        });
    }

    return parts;
}

// Removes all entries from the #partsrow-table
function clearPartsFromList() {
    var rows = document.querySelectorAll("#partsrow-table tbody tr:not(.partsrow-template)");
    for (var i = 0; i < rows.length; ++i) {
        var row = rows[i];
        row.remove();
    }
}

// Map from HTML entities to encoded entities
var entitiesMap = { // See https://www.w3.org/TR/html4/sgml/entities.html
    // Character entity references for ISO 8859-1 characters
    "&nbsp;": "&#160;",
    "&iexcl;": "&#161;",
    "&cent;": "&#162;",
    "&pound;": "&#163;",
    "&curren;": "&#164;",
    "&yen;": "&#165;",
    "&brvbar;": "&#166;",
    "&sect;": "&#167;",
    "&uml;": "&#168;",
    "&copy;": "&#169;",
    "&ordf;": "&#170;",
    "&laquo;": "&#171;",
    "&not;": "&#172;",
    "&shy;": "&#173;",
    "&reg;": "&#174;",
    "&macr;": "&#175;",
    "&deg;": "&#176;",
    "&plusmn;": "&#177;",
    "&sup2;": "&#178;",
    "&sup3;": "&#179;",
    "&acute;": "&#180;",
    "&micro;": "&#181;",
    "&para;": "&#182;",
    "&middot;": "&#183;",
    "&cedil;": "&#184;",
    "&sup1;": "&#185;",
    "&ordm;": "&#186;",
    "&raquo;": "&#187;",
    "&frac14;": "&#188;",
    "&frac12;": "&#189;",
    "&frac34;": "&#190;",
    "&iquest;": "&#191;",
    "&Agrave;": "&#192;",
    "&Aacute;": "&#193;",
    "&Acirc;": "&#194;",
    "&Atilde;": "&#195;",
    "&Auml;": "&#196;",
    "&Aring;": "&#197;",
    "&AElig;": "&#198;",
    "&Ccedil;": "&#199;",
    "&Egrave;": "&#200;",
    "&Eacute;": "&#201;",
    "&Ecirc;": "&#202;",
    "&Euml;": "&#203;",
    "&Igrave;": "&#204;",
    "&Iacute;": "&#205;",
    "&Icirc;": "&#206;",
    "&Iuml;": "&#207;",
    "&ETH;": "&#208;",
    "&Ntilde;": "&#209;",
    "&Ograve;": "&#210;",
    "&Oacute;": "&#211;",
    "&Ocirc;": "&#212;",
    "&Otilde;": "&#213;",
    "&Ouml;": "&#214;",
    "&times;": "&#215;",
    "&Oslash;": "&#216;",
    "&Ugrave;": "&#217;",
    "&Uacute;": "&#218;",
    "&Ucirc;": "&#219;",
    "&Uuml;": "&#220;",
    "&Yacute;": "&#221;",
    "&THORN;": "&#222;",
    "&szlig;": "&#223;",
    "&agrave;": "&#224;",
    "&aacute;": "&#225;",
    "&acirc;": "&#226;",
    "&atilde;": "&#227;",
    "&auml;": "&#228;",
    "&aring;": "&#229;",
    "&aelig;": "&#230;",
    "&ccedil;": "&#231;",
    "&egrave;": "&#232;",
    "&eacute;": "&#233;",
    "&ecirc;": "&#234;",
    "&euml;": "&#235;",
    "&igrave;": "&#236;",
    "&iacute;": "&#237;",
    "&icirc;": "&#238;",
    "&iuml;": "&#239;",
    "&eth;": "&#240;",
    "&ntilde;": "&#241;",
    "&ograve;": "&#242;",
    "&oacute;": "&#243;",
    "&ocirc;": "&#244;",
    "&otilde;": "&#245;",
    "&ouml;": "&#246;",
    "&divide;": "&#247;",
    "&oslash;": "&#248;",
    "&ugrave;": "&#249;",
    "&uacute;": "&#250;",
    "&ucirc;": "&#251;",
    "&uuml;": "&#252;",
    "&yacute;": "&#253;",
    "&thorn;": "&#254;",
    "&yuml;": "&#255;",

    // Character entity references for symbols, mathematical symbols, and Greek letters
    "&fnof;": "&#402;",
    "&Alpha;": "&#913;",
    "&Beta;": "&#914;",
    "&Gamma;": "&#915;",
    "&Delta;": "&#916;",
    "&Epsilon;": "&#917;",
    "&Zeta;": "&#918;",
    "&Eta;": "&#919;",
    "&Theta;": "&#920;",
    "&Iota;": "&#921;",
    "&Kappa;": "&#922;",
    "&Lambda;": "&#923;",
    "&Mu;": "&#924;",
    "&Nu;": "&#925;",
    "&Xi;": "&#926;",
    "&Omicron;": "&#927;",
    "&Pi;": "&#928;",
    "&Rho;": "&#929;",
    "&Sigma;": "&#931;",
    "&Tau;": "&#932;",
    "&Upsilon;": "&#933;",
    "&Phi;": "&#934;",
    "&Chi;": "&#935;",
    "&Psi;": "&#936;",
    "&Omega;": "&#937;",
    "&alpha;": "&#945;",
    "&beta;": "&#946;",
    "&gamma;": "&#947;",
    "&delta;": "&#948;",
    "&epsilon;": "&#949;",
    "&zeta;": "&#950;",
    "&eta;": "&#951;",
    "&theta;": "&#952;",
    "&iota;": "&#953;",
    "&kappa;": "&#954;",
    "&lambda;": "&#955;",
    "&mu;": "&#956;",
    "&nu;": "&#957;",
    "&xi;": "&#958;",
    "&omicron;": "&#959;",
    "&pi;": "&#960;",
    "&rho;": "&#961;",
    "&sigmaf;": "&#962;",
    "&sigma;": "&#963;",
    "&tau;": "&#964;",
    "&upsilon;": "&#965;",
    "&phi;": "&#966;",
    "&chi;": "&#967;",
    "&psi;": "&#968;",
    "&omega;": "&#969;",
    "&thetasym;": "&#977;",
    "&upsih;": "&#978;",
    "&piv;": "&#982;",
    "&bull;": "&#8226;",
    "&hellip;": "&#8230;",
    "&prime;": "&#8242;",
    "&Prime;": "&#8243;",
    "&oline;": "&#8254;",
    "&frasl;": "&#8260;",
    "&weierp;": "&#8472;",
    "&image;": "&#8465;",
    "&real;": "&#8476;",
    "&trade;": "&#8482;",
    "&alefsym;": "&#8501;",
    "&larr;": "&#8592;",
    "&uarr;": "&#8593;",
    "&rarr;": "&#8594;",
    "&darr;": "&#8595;",
    "&harr;": "&#8596;",
    "&crarr;": "&#8629;",
    "&lArr;": "&#8656;",
    "&uArr;": "&#8657;",
    "&rArr;": "&#8658;",
    "&dArr;": "&#8659;",
    "&hArr;": "&#8660;",
    "&forall;": "&#8704;",
    "&part;": "&#8706;",
    "&exist;": "&#8707;",
    "&empty;": "&#8709;",
    "&nabla;": "&#8711;",
    "&isin;": "&#8712;",
    "&notin;": "&#8713;",
    "&ni;": "&#8715;",
    "&prod;": "&#8719;",
    "&sum;": "&#8721;",
    "&minus;": "&#8722;",
    "&lowast;": "&#8727;",
    "&radic;": "&#8730;",
    "&prop;": "&#8733;",
    "&infin;": "&#8734;",
    "&ang;": "&#8736;",
    "&and;": "&#8743;",
    "&or;": "&#8744;",
    "&cap;": "&#8745;",
    "&cup;": "&#8746;",
    "&int;": "&#8747;",
    "&there4;": "&#8756;",
    "&sim;": "&#8764;",
    "&cong;": "&#8773;",
    "&asymp;": "&#8776;",
    "&ne;": "&#8800;",
    "&equiv;": "&#8801;",
    "&le;": "&#8804;",
    "&ge;": "&#8805;",
    "&sub;": "&#8834;",
    "&sup;": "&#8835;",
    "&nsub;": "&#8836;",
    "&sube;": "&#8838;",
    "&supe;": "&#8839;",
    "&oplus;": "&#8853;",
    "&otimes;": "&#8855;",
    "&perp;": "&#8869;",
    "&sdot;": "&#8901;",
    "&lceil;": "&#8968;",
    "&rceil;": "&#8969;",
    "&lfloor;": "&#8970;",
    "&rfloor;": "&#8971;",
    "&lang;": "&#9001;",
    "&rang;": "&#9002;",
    "&loz;": "&#9674;",
    "&spades;": "&#9824;",
    "&clubs;": "&#9827;",
    "&hearts;": "&#9829;",
    "&diams;": "&#9830;",

    // Character entity references for markup-significant and internationalization characters
    // (excluding C0 Controls and Basic Latin which are supported by XHTML)
    "&OElig;": "&#338;",
    "&oelig;": "&#339;",
    "&Scaron;": "&#352;",
    "&scaron;": "&#353;",
    "&Yuml;": "&#376;",
    "&circ;": "&#710;",
    "&tilde;": "&#732;",
    "&ensp;": "&#8194;",
    "&emsp;": "&#8195;",
    "&thinsp;": "&#8201;",
    "&zwnj;": "&#8204;",
    "&zwj;": "&#8205;",
    "&lrm;": "&#8206;",
    "&rlm;": "&#8207;",
    "&ndash;": "&#8211;",
    "&mdash;": "&#8212;",
    "&lsquo;": "&#8216;",
    "&rsquo;": "&#8217;",
    "&sbquo;": "&#8218;",
    "&ldquo;": "&#8220;",
    "&rdquo;": "&#8221;",
    "&bdquo;": "&#8222;",
    "&dagger;": "&#8224;",
    "&Dagger;": "&#8225;",
    "&permil;": "&#8240;",
    "&lsaquo;": "&#8249;",
    "&rsaquo;": "&#8250;",
    "&euro;": "&#8364;"
};

// Function that does a best-effort "conversion" from the HTML we see in
// reddit posts to the XHTML expected in EPUBs
function epubXHTMLFromRedditHTML(html) {
    return html.replace(/<a href="\//gi, '<a href="https://www.reddit.com/') // Make reddit internal links absolute. Makes assumptions.
        .replace(/&\w+\;/g, function(match) { // Replace named HTML entities with XHTML compatible numbered ones
            return entitiesMap[match] || match;
        });
};

// Creates a epub files with the current title, author and parts from the #partsrow-table
// and provides it to the user for download.
function createAndDownloadSeriesAsEpub(event)
{
    event.preventDefault();

    var epubMakerBtn = document.getElementById("epubMakerBtn");
    epubMakerBtn.disabled = true;

    var parts = getPartsFromList();
    collectPartPosts(parts, {
        collectedPost: function (post) {
            var row = getRowForPart(post.url);
            if (row) {
                updateRowState(row, isNameCached(nameFromURL(post.url)) ? "success" : "none");
                row.scrollIntoView(true);
            }
            log("Collected post in series: '" + post.title + "'");
        },
        done: function(posts) {
            log("All " + posts.length + " series parts available. Creating epub.", "success");

            var title = document.querySelector('#seriesTitle').value;
            var author = document.querySelector('#seriesAuthor').value;

            var epubMaker = new EpubMaker()
                .withUuid(author + " - " + title)
                .withTemplate('idpf-wasteland')
                .withTitle(title)
                .withAuthor(author)
                .withLanguage('en')
                .withModificationDate(new Date())
                .withSection(new EpubMaker.Section('titlepage', 'titlepage', {
                        content: '<div style="text-align: center;">' +
                        '<h1>' + he.encode(title) + '</h1>' +
                        '<h3>by <a href="https://reddit.com/u/' + he.encode(author) + '">' + he.encode(author) + '</a></h3>' +
                        '<p>This EPUB was created using <a href="https://github.com/hacst/hfy2epub">https://github.com/hacst/hfy2epub</a> and must not to be distributed without the author\'s consent</p>' +
                        '</div>' +
                        '<div style="page-break-before:always;"></div>'
                    }, false, true)
                );

            posts.forEach(function (post) {
                epubMaker.withSection(new EpubMaker.Section("chapter", post.name, {
                    content: epubXHTMLFromRedditHTML(post.content),
                    title: post.title
                }, true, false))
            });

            epubMakerBtn.disabled = false;
            epubMaker.downloadEpub(function (epubZipContent, filename) {
                epubMakerBtn.href = URL.createObjectURL(epubZipContent);
                epubMakerBtn.download = filename;
                epubMakerBtn.removeEventListener('click', createAndDownloadSeriesAsEpub);
            });
        },
        error: function(error) {
            var msg = "Aborting collection due to failure to collect '" + error.part.title + "': " + error.message;
            log(msg, "danger");
            var row = getRowForPart(error.part.url);
            updateRowState(row, "danger");
            row.scrollIntoView(true);
            alert(msg);
            epubMakerBtn.disabled = false;
        }
    });
}

// Tries to fill the title, author and parts table for the current start URL
function retrieveSeriesInfo(event)
{
    event.preventDefault();
    var retrieveInfoBtn = document.getElementById("retrieveInfoBtn");
    retrieveInfoBtn.disabled = true;
    clearPartsFromList();
    var startUrl = unshorten(getStartUrl());

    requestRedditJSONCached(startUrl, function(json) {
        if (json.kind == "wikipage") {
            collectSeriesInfoFromWikiPage(startUrl, function(series) {
                    log("Retrieved series information from '" + startUrl + "'. Referenced " + series.parts.length + " parts.", "success");
                    console.log(series);
                    document.querySelector('#seriesAuthor').value = series.author;
                    document.querySelector('#seriesTitle').value = series.title;

                    series.parts.forEach(function(part) { addPartToList(part); });

                    document.getElementById("epubMakerBtn").scrollIntoView(false);
                    retrieveInfoBtn.disabled = false;
                },
                function (error) {
                    var msg = "Failed to retrieve series information from '" + startUrl + "'. Reason: " + error;
                    log(msg, "danger");
                    console.log(error);
                    alert(msg);
                    retrieveInfoBtn.disabled = false;
                });
        }
        else {
            collectPost(startUrl, function(post) {
                    log("Retrieved author and title from first post. Will now collect posts in series.", "success");
                    document.querySelector('#seriesAuthor').value = post.author;
                    document.querySelector('#seriesTitle').value = post.title;

                    findSeriesParts(startUrl, {
                        foundUrl: function(url) {
                            addPartToList({
                                title: "?",
                                url: url
                            });
                        },
                        collectedPost: function(post) {
                            log("Found post in series: '" + post.title + "'");
                            addOrUpdatePartInList(post);
                        },
                        done: function(posts) {
                            log("Done following series links. Found " + posts.length + " posts", "success");
                            document.getElementById("epubMakerBtn").scrollIntoView(false);
                            retrieveInfoBtn.disabled = false;
                        },
                        error: function(error) {
                            var msg = "Error while following series links. Reason: " + error;
                            log(msg, "danger");
                            console.log(msg);
                            alert(msg);
                            retrieveInfoBtn.disabled = false;
                        }
                    });
                },
                function (error) {
                    var msg = "Failed to retrieve series info. Reason: " + error;
                    log(msg, "danger");
                    console.log(msg);
                    alert(msg);
                    retrieveInfoBtn.disabled = false;
                });
        }
    }, function(error) {
        log("Failed to retrieve given page '" + startUrl + "'.", "danger");
        console.log(error);
        retrieveInfoBtn.disabled = false;
    });
    document.getElementById("seriesInformationHead").scrollIntoView(true);
}

var delayBetweenRequestsInput  = document.getElementById("delayBetweenRequests");
delayBetweenRequestsInput.addEventListener('input', function(val) {
   timeInMsBetweenRequests = val * 1000.0;
});

var retrieveInfoForm = document.querySelector('#retrieveInfoForm');
retrieveInfoForm.addEventListener('submit', retrieveSeriesInfo);

Sortable.create(document.querySelector("#partsrow-table tbody"), {
    handle: ".partsrow-draghandle"
});

document.getElementById("partsrow-add-btn").addEventListener("click", function(event) {
    event.preventDefault();
    addPartToList({
        url: "",
        title: ""
    });
});

var epubMakerForm = document.querySelector('#epubMakerForm');
epubMakerForm.addEventListener('submit', createAndDownloadSeriesAsEpub);
