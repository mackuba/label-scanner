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
  document.getElementById('search').handle.addEventListener('focus', function() {
    setTimeout(() => { this.select() }, 10);
  });
}

async function loadLabellers() {
  let json = await blue.getRequest('eu.mackuba.private.getLabellers');
  return json.labellers;
}

function submitSearch(event) {
  event.preventDefault();
  let handle = this.handle.value;

  if (handle.trim().length == 0) {
    return;
  }

  this.handle.blur();
  this.search.disabled = true;
  resultField.innerText = 'Scanning labels...';
  foundLabels.innerHTML = '';

  labellersPromise.then(() => {
    scanHandle(handle)
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
  let labels = [];

  for (let profile of results) {
    labels = labels.concat(profile.labels.filter(x => (x.src != userDID)));
  }

  if (labels.length > 0) {
    let sources = Array.from(new Set(labels.map(x => x.src)));

    let labellerProfiles = await appView.getRequest('app.bsky.actor.getProfiles', { actors: sources });
    for (let profile of labellerProfiles.profiles) {
      labels.filter(x => (x.src == profile.did)).forEach(x => { x.labeller = profile });
    }    
  }

  return labels;
}

async function checkProfileWithLabellers(handle, batch) {
  let labellersList = batch.map(x => x.did).join(',');
  let headers = { 'atproto-accept-labelers': labellersList };

  return appView.getRequest('app.bsky.actor.getProfile', { actor: handle }, { headers });
}

function showLabels(labels) {
  if (labels == 0) {
    resultField.innerText = '✅ No labels found';
  } else {
    resultField.innerText = `⚠️ ${labels.length} label${labels.length == 1 ? '' : 's'} found:`;
  }

  for (let label of labels) {
    let p = document.createElement('p');
    p.innerText = `“${label.val}” from `;

    let a = document.createElement('a');
    a.innerText = label.labeller.displayName;
    a.href = `https://bsky.app/profile/${label.labeller.handle}`;
    p.append(a);

    foundLabels.appendChild(p);
  }
}
