const batchSize = 20;

const acceptedHostnames = [
  'bsky.app',
  'main.bsky.dev',
  'deer.social',
];

class URLError extends Error {}
class AccountError extends Error {}
class PostTakenDownError extends Error {}

document.addEventListener("DOMContentLoaded", function() {
  initScanner();
});

function initScanner() {
  window.resultField = document.getElementById('result');
  window.noteField = document.getElementById('note');
  window.foundLabels = document.getElementById('found_labels');

  window.blue = new Minisky('blue.mackuba.eu');
  window.appView = new Minisky('api.bsky.app');

  window.labellersPromise = loadLabellers();
  labellersPromise.then(list => {
    window.labellers = list;
  });

  let form = document.getElementById('search');

  form.addEventListener('submit', submitSearch);
  form.query.addEventListener('focus', function() {
    setTimeout(() => { this.select() }, 10);
  });

  form.query.focus();
}

async function loadLabellers() {
  let json = await blue.getRequest('blue.feeds.mod.getLabellers');
  return json.labellers;
}

function submitSearch(event) {
  event.preventDefault();
  let query = this.query.value;

  if (query.trim().length == 0) {
    return;
  }

  let doScan;

  if (query.includes('://')) {
    doScan = scanURL(query);
  } else if (query.match(/^@?[\w\-]+(\.[\w\-]+)+$/)) {
    query = query.replace(/^@/, '');
    doScan = scanHandle(query);
  } else if (query.match(/^did\:\w+\:/)) {
    doScan = scanAccount(query);
  } else {
    resultField.innerText = '🤨 Enter a user handle or a post URL.';
    foundLabels.innerHTML = '';
    return;
  }

  this.query.blur();
  this.search.disabled = true;
  resultField.innerHTML = 'Scanning labels... <i class="loader fa-solid fa-spinner fa-spin fa-sm"></i>';
  noteField.style.display = 'none';
  foundLabels.innerHTML = '';

  labellersPromise.then(() => {
    doScan
      .then((data) => {
        showLabels(data.labels);

        if (data.note) {
          noteField.innerText = data.note;
          noteField.style.display = 'block';
        }
      })
      .catch((error) => {
        displayError(error);
      })
      .finally(() => {
        this.search.disabled = false;
      });
  });
}

function displayError(error) {
  if (error instanceof APIError) {
    if (error.code == 400) {
      if (error.json.error == 'AccountTakedown') {
        resultField.innerText = '🚫 Account was taken down';
        return;
      } else if (error.json.error == 'InvalidRequest') {
        if (error.json.message == 'Profile not found') {
          resultField.innerText = '🚫 Account not found';
          return;
        } else if (error.json.message == 'Unable to resolve handle') {
          resultField.innerText = '👾 Unable to resolve handle';
          return;
        }
      } else if (error.json.error == 'AccountDeactivated' || error.json.error == 'RepoDeactivated') {
        resultField.innerText = '😶‍🌫️ Account is deactivated';
        return;
      } else if (error.json.error == 'RecordNotFound') {
        resultField.innerText = '🚫 Post not found';
        return;
      } else if (error.json.error == 'RepoNotFound') {
        resultField.innerText = '🚫 Account was deleted';
        return;
      }
    }

    resultField.innerText = error;
    return;
  } else if (error instanceof URLError) {
    resultField.innerText = `⚠️ ${error.message}`;
    return;
  } else if (error instanceof PostTakenDownError) {
    resultField.innerText = `🚫 Post was taken down on the AppView`;
    return;
  } else if (error instanceof AccountError) {
    resultField.innerText = '🚫 Account not found';
    return;
  }

  resultField.innerText = `${error.constructor.name}: ${error.message}`;
}

async function scanHandle(handle) {
  let json = await appView.getRequest('com.atproto.identity.resolveHandle', { handle });
  let userDID = json.did;

  return await scanAccount(userDID);
}

async function scanAccount(userDID) {
  let batches = [];

  for (let i = 0; i < labellers.length; i += batchSize) {
    let slice = labellers.slice(i, i + batchSize);
    batches.push(checkProfileWithLabellers(userDID, slice));
  }

  let results = await Promise.all(batches);
  let labels = results.flatMap(x => x.labels).filter(x => (x.src != userDID));

  return { labels };
}

async function scanURL(string) {
  let atURI, note, userDID, rkey;

  let match = string.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([\w]+)$/);

  if (match) {
    atURI = string;
    userDID = match[1];
    rkey = match[2];
  } else {
    let url = new URL(string);

    if (url.protocol != 'https:') {
      throw new URLError('URL must start with https://');
    }

    if (!acceptedHostnames.includes(url.host)) {
      note = "Note: URL domain not recognized. Returned labels might be incorrect."
    }

    window.webClientHost = url.host;

    let match = url.pathname.match(/^\/profile\/([^/]+)\/?$/);

    if (match && match[1].startsWith('did:')) {
      return { note, ... await scanAccount(match[1]) };
    } else if (match) {
      return { note, ... await scanHandle(match[1]) };
    } else {
      let match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([\w]+)\/?$/);

      if (match && match[1].startsWith('did:')) {
        userDID = match[1];
        rkey = match[2];
      } else if (match) {
        let json = await appView.getRequest('com.atproto.identity.resolveHandle', { handle: match[1] });
        userDID = json.did;
        rkey = match[2];
      } else {
        throw new URLError('Unknown URL');
      }

      atURI = `at://${userDID}/app.bsky.feed.post/${rkey}`;
    }
  }

  let batches = [];

  for (let i = 0; i < labellers.length; i += batchSize) {
    let slice = labellers.slice(i, i + batchSize);
    batches.push(checkAtURIWithLabellers(atURI, slice));
  }

  let results = await Promise.all(batches);

  if (results.every(x => !x)) {
    // post not found, look it up on the origin PDS

    let post = await loadPostFromPDS(userDID, rkey);

    // post found, so it was taken down on the AppView

    throw new PostTakenDownError();
  }

  let labels = results.flatMap(x => x.labels).filter(x => (x.src != userDID));
  return { labels, note };
}

async function loadPostFromPDS(did, rkey) {
  let didDocument = await fetchDidDocument(did);

  if (didDocument.message?.startsWith("DID not registered:")) {
    throw new AccountError("Account not found");
  }

  let pds = didDocument.service?.find(x => x.id == "#atproto_pds")?.serviceEndpoint;

  if (!pds) {
    throw new AccountError("Invalid DID document");
  }

  let pdsSky = new Minisky(pds);
  let repo = await pdsSky.getRequest('com.atproto.repo.describeRepo', { repo: did });

  return await pdsSky.getRequest('com.atproto.repo.getRecord', {
    repo: did,
    collection: 'app.bsky.feed.post',
    rkey: rkey
  });
}

async function fetchDidDocument(did) {
  if (did.startsWith('did:plc:')) {
    let response = await fetch(`https://plc.directory/${did}`);
    return await response.json();
  } else if (did.startsWith('did:web:')) {
    let hostname = did.split(':')[2];
    let response = await fetch(`https://${hostname}/.well-known/did.json`);
    return await response.json();
  } else {
    throw new AccountError("DID not found");
  }
}

async function checkProfileWithLabellers(handle, batch) {
  let labellersList = batch.map(x => x.did).join(',');
  let headers = { 'atproto-accept-labelers': labellersList };

  return appView.getRequest('app.bsky.actor.getProfile', { actor: handle }, { headers });
}

async function checkAtURIWithLabellers(uri, batch) {
  let labellersList = batch.map(x => x.did).join(',');
  let headers = { 'atproto-accept-labelers': labellersList };

  let result = await appView.getRequest('app.bsky.feed.getPosts', { uris: uri }, { headers });
  return result.posts[0];
}

function showLabels(labels) {
  if (labels.length == 0) {
    resultField.innerText = '✅ No labels found';
    return;
  }

  if (labels.length == 1) {
    resultField.innerHTML = `<i class="tags fa-solid fa-tag"></i> 1 label found:`;
  } else {
    resultField.innerHTML = `<i class="tags fa-solid fa-tags"></i> ${labels.length} labels found:`;
  }

  let host = window.webClientHost ?? 'bsky.app';

  for (let label of labels) {
    let labeller = labellers.find(x => (x.did == label.src));

    let p = document.createElement('p');
    p.innerText = `“${label.val}” from `;

    let a = document.createElement('a');
    a.innerText = labeller.name || labeller.handle;
    a.href = `https://${host}/profile/${labeller.handle}`;
    p.append(a);

    foundLabels.appendChild(p);
  }
}
