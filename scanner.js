document.addEventListener("DOMContentLoaded", function() {
  initScanner();
});

function initScanner() {
  window.resultField = document.getElementById('result');
  window.foundLabels = document.getElementById('found_labels');

  window.blue = new Minisky('blue.mackuba.eu');
  window.appView = new Minisky('api.bsky.app');

  window.labellersPromise = loadLabellers();
  labellersPromise.then(list => {
    window.labellers = list;
  });

  document.getElementById('search').addEventListener('submit', submitSearch);
  document.getElementById('search').query.addEventListener('focus', function() {
    setTimeout(() => { this.select() }, 10);
  });
}

async function loadLabellers() {
  let json = await blue.getRequest('eu.mackuba.private.getLabellers');
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
  } else {
    resultField.innerText = 'Enter a user handle or a post URL.';
    foundLabels.innerHTML = '';
    return;
  }

  this.query.blur();
  this.search.disabled = true;
  resultField.innerHTML = 'Scanning labels... <i class="loader fa-solid fa-spinner fa-spin fa-sm"></i>';
  foundLabels.innerHTML = '';

  labellersPromise.then(() => {
    doScan
      .then((labels) => {
        showLabels(labels);
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

  let batches = [];

  for (let i = 0; i < labellers.length; i += 10) {
    let slice = labellers.slice(i, i + 10);
    batches.push(checkProfileWithLabellers(userDID, slice));
  }

  let results = await Promise.all(batches);
  return results.flatMap(x => x.labels).filter(x => (x.src != userDID));
}

async function scanURL(url) {
  let atURI;

  if (url.match(/^at:\/\/did:[^/]+\/app\.bsky\.feed\.post\/[\w]+$/)) {
    atURI = url;
  } else {
    let match = url.match(/^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([\w]+)\/?$/);

    if (match && match[1].includes('did:')) {
      atURI = `at://${match[1]}/app.bsky.feed.post/${match[2]}`;
    } else if (match) {
      let json = await appView.getRequest('com.atproto.identity.resolveHandle', { handle: match[1] });
      atURI = `at://${json.did}/app.bsky.feed.post/${match[2]}`;
    } else {
      throw 'Invalid URL';
    }
  }

  let userDID = atURI.split('/')[2];
  let batches = [];

  for (let i = 0; i < labellers.length; i += 10) {
    let slice = labellers.slice(i, i + 10);
    batches.push(checkAtURIWithLabellers(atURI, slice));
  }

  let results = await Promise.all(batches);
  return results.flatMap(x => x.labels).filter(x => (x.src != userDID));
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

  for (let label of labels) {
    let labeller = labellers.find(x => (x.did == label.src));

    let p = document.createElement('p');
    p.innerText = `“${label.val}” from `;

    let a = document.createElement('a');
    a.innerText = labeller.name || labeller.handle;
    a.href = `https://bsky.app/profile/${labeller.handle}`;
    p.append(a);

    foundLabels.appendChild(p);
  }
}
