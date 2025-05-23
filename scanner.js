const batchSize = 20;

const acceptedHostnames = [
  'bsky.app',
  'main.bsky.dev',
  'deer.social',
];

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
    resultField.innerText = 'Enter a user handle or a post URL.';
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
        resultField.innerText = error;
      })
      .finally(() => {
        this.search.disabled = false;      
      });
  });
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
  let atURI, note;

  if (string.match(/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[\w]+$/)) {
    atURI = string;
  } else {
    let url = new URL(string);

    if (url.protocol != 'https:') {
      throw 'URL must start with https://';
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
        atURI = `at://${match[1]}/app.bsky.feed.post/${match[2]}`;
      } else if (match) {
        let json = await appView.getRequest('com.atproto.identity.resolveHandle', { handle: match[1] });
        atURI = `at://${json.did}/app.bsky.feed.post/${match[2]}`;
      } else {
        throw 'Invalid URL';
      }
    }
  }

  let userDID = atURI.split('/')[2];
  let batches = [];

  for (let i = 0; i < labellers.length; i += batchSize) {
    let slice = labellers.slice(i, i + batchSize);
    batches.push(checkAtURIWithLabellers(atURI, slice));
  }

  let results = await Promise.all(batches);

  if (results.every(x => !x)) {
    throw '🚫 Post not found.';
  }

  let labels = results.flatMap(x => x.labels).filter(x => (x.src != userDID));
  return { labels, note };
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
