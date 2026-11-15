/* natively · Team-Version: GitHub als Ablage
   Ersetzt die Brücke native(cmd, arg) der Mac-App. Jeder Bereich = ein GitHub-Repo, alle Repos erscheinen als ein Baum.
   Der Zugang (GitHub-Token) liegt nur im Browser (localStorage). Rechte prüft immer GitHub, natively blendet nichts nur zum Schein aus.
   Wird vor app.js geladen. */
(function(){
'use strict';
const API = window.NATIVELY_API || 'https://api.github.com';
const GQL = window.NATIVELY_GQL || '/graphql';   // wird an API angehängt
const AUTH_KEY = 'natively:gh', BLOB_KEY = 'natively:gh:blobs', DATE_KEY = 'natively:gh:dates', PREF_KEY = 'natively:gh:prefs';
const MD = /\.(md|markdown|mdown)$/i;
const SKIP = new Set(['node_modules', 'dist', 'build', 'vendor', '.git']);
const OVERVIEW = 'natively';

const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(e) { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch(e) {} };
const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const T = (k, v) => window.t ? window.t(k, v) : k;
const ui = () => window.natively;
const day = d => new Date(d).toLocaleDateString('sv-SE');   // JJJJ-MM-TT in Ortszeit
const today = () => day(Date.now());

let auth = read(AUTH_KEY);
let me = null, installs = [], pending = [], repos = [], data = { sources:[], files:[], home:'' };
let blobs = read(BLOB_KEY) || {}, dates = read(DATE_KEY) || {};
const dirty = {};            // id → { base, sha }: ungespeicherte Änderungen
const access = {};           // full_name → { people:[], teams:[], invites:[], error }

/* ---------- Texte (Englisch und Deutsch, .gh ersetzt den Text der Mac-App) ---------- */
Object.assign(I18N.en, {
  'welcome.title.gh': 'Your team knowledge', 'welcome.lead.gh': 'All areas you have access to on GitHub, as one tree. Only Markdown files are shown. Every change is saved as a version.',
  'welcome.loadingTitle.gh': 'Loading your areas …', 'welcome.loadingWeb.gh': 'natively is reading the Markdown files from GitHub.',
  'sources.card.gh': 'Areas · from GitHub', 'sources.aria.gh': 'Areas', 'btn.addFolder.gh': 'New area', 'btn.rescan.gh': 'Reload',
  'tree.noSource.gh': 'Sign in with GitHub to see your areas.', 'tree.pickSources.gh': 'Sign in', 'tree.loading.gh': 'Loading from GitHub …',
  'btn.reveal.gh': 'Open on GitHub', 'menu.copyPath.gh': 'Copy path', 'nav.sources.gh': 'Areas', 'composer.placeholder.gh': 'Search all areas',
  'sources.one.gh': '1 area', 'sources.many.gh': '{n} areas',
  'gh.signin': 'Sign in with GitHub', 'gh.signinText': 'natively shows the knowledge of your team from GitHub. You only see the areas your GitHub account has access to.',
  'gh.signedIn': 'Signed in as {who}', 'gh.signout': 'Sign out', 'gh.admin': 'Admin', 'gh.noInstall': 'natively is not yet installed in your GitHub organisation, or you have no area yet.',
  'gh.install': 'Install natively on GitHub', 'gh.expired': 'Your GitHub sign-in has expired. Please sign in again.', 'gh.notConfigured': 'Sign-in is not set up yet (GitHub App missing).',
  'gh.unsaved': 'Unsaved changes', 'gh.discard': 'Discard', 'gh.save': 'Save', 'gh.saving': 'Saving …', 'gh.saved': 'Saved · new version on GitHub', 'gh.readonly': 'Read only',
  'gh.addBlock': 'Add paragraph', 'gh.newText': 'New text', 'gh.editHint': 'Click into the text to edit',
  'gh.conflictTitle': 'Not saved: someone else changed this file', 'gh.conflictText': '{who} changed “{name}” {when}, while you were editing it. To make sure nothing gets lost, natively did not overwrite anything.',
  'gh.loadNew': 'Load their version (mine goes to the clipboard)', 'gh.keepMine': 'Save mine anyway', 'gh.cancel': 'Cancel', 'gh.copiedMine': 'Your version is in the clipboard',
  'gh.someone': 'Someone', 'gh.discardAsk': 'Discard your changes to {name}?', 'gh.leaveAsk': 'You have unsaved changes.',
  'gh.adminTitle': 'Admin · rights per area', 'gh.adminLead': 'Rights always apply to a whole area. Everything you change here is changed directly on GitHub.',
  'gh.areas': 'Areas', 'gh.people': 'People', 'gh.teams': 'Teams', 'gh.invites': 'Pending invitations', 'gh.invite': 'Invite', 'gh.invitePh': 'GitHub username',
  'gh.remove': 'Remove', 'gh.removeAsk': 'Remove {who} from {area}?', 'gh.revoke': 'Withdraw',
  'gh.role.pull': 'Read', 'gh.role.triage': 'Comment', 'gh.role.push': 'Edit', 'gh.role.maintain': 'Manage', 'gh.role.admin': 'Admin', 'gh.role.none': 'No access',
  'gh.personal': 'This area belongs to a personal account. There, invited people can always edit. For read-only rights and teams the area must be in a workspace.',
  'gh.noAdmin': 'You are not admin of any area.', 'gh.newArea': 'New area', 'gh.newAreaPh': 'name, e.g. marketing', 'gh.create': 'Create',
  'gh.created': 'Area {name} created', 'gh.changed': 'Changed on GitHub', 'gh.invited': '{who} invited', 'gh.failed': 'GitHub says: {msg}',
  'gh.startTitle': 'Get started in 2 minutes', 'gh.startText': 'Two steps on GitHub, natively sets up everything else.',
  'gh.step1': 'Create an organisation on GitHub', 'gh.step1Text': 'Your company gets its own free organisation on GitHub. Only there do teams and read-only rights exist. Choose the “Free” plan.',
  'gh.step1Btn': 'Create organisation', 'gh.step1Have': 'We have one', 'gh.step1Done': 'Done. If not, open it again.',
  'gh.step2': 'Allow natively in the organisation', 'gh.step2Text': 'On GitHub pick your organisation, choose “All repositories” and click Install. You come right back here and set up the workspace in one click.',
  'gh.tryPersonal': 'Just trying it alone? Install natively on your own account', 'gh.firstOrg': 'For a team with teams and read-only rights, create an organisation first.',
  'gh.start': 'Allow natively', 'gh.firstTitle': 'Create your first area', 'gh.firstText': 'natively is set up for {who}. An area is a folder with its own rights, e.g. for the whole team.', 'gh.first': 'Create first area “wissen”',
  'gh.org': 'Workspace', 'gh.orgLead': 'Everyone in your workspace. Rights come from teams: put a person in a team and they get exactly the areas of that team.', 'gh.loading': 'Loading …',
  'gh.baseWarn': 'Careful: every member currently has “{role}” in every area. For rights per area set “Base permissions” to “No permission” on GitHub.', 'gh.baseFix': 'Change on GitHub',
  'gh.requests': 'Access requests', 'gh.reqLine': '{who} wants {role} in {area}', 'gh.approve': 'Approve', 'gh.reject': 'Decline', 'gh.approved': 'Approved, rights set on GitHub', 'gh.rejected': 'Declined',
  'gh.approvedBy': 'Approved by {who}', 'gh.rejectedBy': 'Declined by {who}', 'gh.noArea': 'There is no area “{area}”', 'gh.noTeam': 'no team', 'gh.noTeams': 'No teams yet. Create teams on GitHub, e.g. “Marketing”.',
  'gh.teamEmpty': 'nobody yet', 'gh.addPerson': '+ Add person', 'gh.orgRemove': 'Remove from workspace', 'gh.orgRemoveAsk': 'Remove {who} from the workspace {org}? They lose all rights in all areas.',
  'gh.outside': 'External people', 'gh.orgInvitePh': 'GitHub username or email',
  'gh.reqBtn': 'Request access', 'gh.reqTitle': 'Request access', 'gh.reqText': 'Your admins see the request in natively and can approve it with one click.',
  'gh.reqAreaPh': 'Which area? e.g. marketing', 'gh.reqWhyPh': 'Why? (optional)', 'gh.reqSend': 'Send request', 'gh.reqSent': 'Request sent to your admins',
  'gh.reqNoOrg': 'You are not in a workspace yet. Ask your admin directly.', 'gh.reqNoAreaName': 'Please enter the area', 'gh.reqHow': 'Admins approve or decline this in natively under Admin → Workspace.',
  'gh.timeline': 'History', 'gh.today': 'Today', 'gh.yesterday': 'Yesterday', 'gh.tl.changed': 'changed {what}', 'gh.tl.added': 'created {what}', 'gh.tl.removed': 'deleted {what}', 'gh.tl.for': 'for {who}',
  'gh.tl.noLines': 'No text lines changed.', 'gh.tl.more': '{n} more lines', 'gh.tl.openVersion': 'Open this version', 'gh.tl.openFile': 'Open file', 'gh.tl.view': 'View',
  'gh.tl.noRights': 'No access to the history of {area}.', 'gh.tl.emptyArea': '{area} has no versions yet.', 'gh.tl.searchPh': 'Search file, person or description', 'gh.tl.person': 'Person', 'gh.tl.allPeople': 'Everyone',
  'gh.tl.area': 'Area', 'gh.tl.allAreas': 'All areas', 'gh.tl.range': 'Time span', 'gh.tl.rangeAll': 'All time', 'gh.tl.range7': 'Last 7 days', 'gh.tl.range30': 'Last 30 days', 'gh.tl.layout': 'View',
  'gh.tl.asTimeline': 'Timeline', 'gh.tl.asTable': 'Table', 'gh.tl.noMatch': 'Nothing matches these filters.', 'gh.tl.none': 'No changes yet.', 'gh.tl.colTime': 'When', 'gh.tl.colFile': 'File', 'gh.tl.colChange': 'Change',
  'gh.tl.wasChanged': 'changed', 'gh.tl.wasAdded': 'created', 'gh.tl.wasRemoved': 'deleted', 'gh.tl.count': '{n} changes loaded', 'gh.tl.loadMore': 'Load more',
  'gh.tl.leadAll': 'Who changed what, across all areas you can see. Straight from the versions on GitHub.', 'gh.tl.leadArea': 'Every change in this area, newest first.', 'gh.tl.leadFile': 'Every version of this file. Open or restore any of them.',
  'gh.tl.restoreShort': 'Restore', 'gh.tl.isCurrent': 'This is the current version', 'gh.tl.fileGone': 'This file no longer exists.', 'gh.tl.restored': 'Restored as a new version',
  'gh.offline': 'No connection', 'gh.restored': '{n} unsaved change(s) restored, saving now', 'gh.lastBy': 'Last changed by {who} · {when}', 'gh.lastAt': 'Last changed {when}',
  'gh.versions': 'Versions', 'gh.versionsOf': 'Versions · {name}', 'gh.current': 'current', 'gh.sameAsNow': 'Same as the current version.', 'gh.restore': 'Restore this version',
  'gh.restoreAsk': 'Restore this version? It becomes a new version, nothing is deleted.', 'gh.restoreMsg': '{who} restored {name} to the version from {when} (natively)',
  'gh.diffTitle': 'Differences to now', 'gh.diffLegend': 'Red was in this version, green is new since then.', 'gh.tooLong': 'File too long for a comparison.', 'gh.created0': 'This is when the file was created.',
  'gh.commitMsg': '{who} edited {name} (natively)', 'gh.updated': '“{name}” was just updated by {who}', 'gh.recentTeam': 'Recently changed in the team',
  'gh.st.pending': 'Changes …', 'gh.st.saving': 'Saving …', 'gh.st.saved': 'Saved', 'gh.st.retry': 'Not saved, retrying', 'gh.st.auth': 'Sign-in expired, your text is safe', 'gh.st.conflict': 'Not saved: someone else changed this file',
  'gh.signoutAsk': 'Some changes are not saved yet. They stay in this browser for your account. Sign out anyway?', 'gh.dropMine': 'Discard mine (to clipboard)', 'gh.recreate': 'Create the file again with my text', 'gh.show': 'Show', 'gh.signinAgain': 'Sign in again', 'gh.tryNow': 'Try now', 'gh.later': 'Later', 'gh.conflictSafe': 'Your text is kept in this browser until you decide.',
  'gh.invitedTo': 'You were invited to the workspace {org}', 'gh.joinText': 'Join with one click, then you see all areas of your team.', 'gh.join': 'Join workspace', 'gh.joined': 'Welcome to the workspace {org}',
  'gh.joinOnGitHub': 'Please accept the invitation to the workspace {org} on GitHub, then come back.', 'gh.setupTitle': 'Set up the workspace {org}', 'gh.setupText': 'One click: natively switches off read access for everyone, creates the team “Alle” and the area “wissen” with a start page and rules for Claude.',
  'gh.setup': 'Set up workspace', 'gh.settingUp': 'Setting up …', 'gh.setupDone': '{org} is ready.', 'gh.setupBaseManual': 'The base permission could not be changed, see Admin.',
  'gh.claude': 'Connect Claude', 'gh.claudeCopied': 'Address copied', 'gh.openMissing': 'This file was not found, or you have no access to it.', 'gh.cl.s4': 'Optional: in Claude open the natively connector and set its tools to <b>Always allow</b>. Then Claude no longer asks before every step.', 'gh.cl.text': 'Set it up once. After that Claude saves straight into natively.', 'gh.cl.s1': '<b>Copy the address</b>', 'gh.cl.s2': 'Open Claude: <b>Customize → Connectors</b>, click <b>+</b> and choose <b>Add custom connector</b>.', 'gh.cl.s3': 'Name <code>natively</code>, paste the address, click <b>Add</b>, then <b>Connect</b> and sign in with GitHub.', 'gh.cl.team': 'Claude Team or Enterprise: an owner adds the connector once under Organization settings → Connectors. Then everyone only clicks Connect.', 'gh.cl.copy': 'Copy', 'gh.cl.open': 'Open Claude', 'gh.cl.admin': 'Organization settings', 'gh.cl.help': 'Help from Claude', 'gh.baseFixNow': 'Fix now', 'gh.invitedLink': '{who} invited. Link copied, send it to them: {link}',
  'gh.yourRole': 'Your role', 'gh.files': 'Files', 'gh.members': 'Members', 'gh.owner': 'Owner'
});
Object.assign(I18N.de, {
  'welcome.title.gh': 'Euer Team-Wissen', 'welcome.lead.gh': 'Alle Bereiche, auf die du bei GitHub Zugriff hast, als ein Baum. Gezeigt werden nur MD-Dateien. Jede Änderung wird als Version gespeichert.',
  'welcome.loadingTitle.gh': 'Lade deine Bereiche …', 'welcome.loadingWeb.gh': 'natively liest die MD-Dateien von GitHub.',
  'sources.card.gh': 'Bereiche · von GitHub', 'sources.aria.gh': 'Bereiche', 'btn.addFolder.gh': 'Neuer Bereich', 'btn.rescan.gh': 'Neu laden',
  'tree.noSource.gh': 'Melde dich mit GitHub an, um deine Bereiche zu sehen.', 'tree.pickSources.gh': 'Anmelden', 'tree.loading.gh': 'Lade von GitHub …',
  'btn.reveal.gh': 'Auf GitHub öffnen', 'menu.copyPath.gh': 'Pfad kopieren', 'nav.sources.gh': 'Bereiche', 'composer.placeholder.gh': 'Alle Bereiche durchsuchen',
  'sources.one.gh': '1 Bereich', 'sources.many.gh': '{n} Bereiche',
  'gh.signin': 'Mit GitHub anmelden', 'gh.signinText': 'natively zeigt das Wissen deines Teams aus GitHub. Du siehst nur die Bereiche, auf die dein GitHub-Konto Zugriff hat.',
  'gh.signedIn': 'Angemeldet als {who}', 'gh.signout': 'Abmelden', 'gh.admin': 'Admin', 'gh.noInstall': 'natively ist in eurer GitHub-Organisation noch nicht installiert, oder du hast noch keinen Bereich.',
  'gh.install': 'natively bei GitHub installieren', 'gh.expired': 'Deine GitHub-Anmeldung ist abgelaufen. Bitte neu anmelden.', 'gh.notConfigured': 'Die Anmeldung ist noch nicht eingerichtet (GitHub App fehlt).',
  'gh.unsaved': 'Nicht gespeicherte Änderungen', 'gh.discard': 'Verwerfen', 'gh.save': 'Speichern', 'gh.saving': 'Speichere …', 'gh.saved': 'Gespeichert · neue Version auf GitHub', 'gh.readonly': 'Nur lesen',
  'gh.addBlock': 'Absatz hinzufügen', 'gh.newText': 'Neuer Text', 'gh.editHint': 'In den Text klicken zum Bearbeiten',
  'gh.conflictTitle': 'Nicht gespeichert: Jemand anderes hat die Datei geändert', 'gh.conflictText': '{who} hat „{name}“ {when} geändert, während du sie bearbeitet hast. Damit nichts verloren geht, hat natively nichts überschrieben.',
  'gh.loadNew': 'Neue Fassung laden (meine in die Zwischenablage)', 'gh.keepMine': 'Meine trotzdem speichern', 'gh.cancel': 'Abbrechen', 'gh.copiedMine': 'Deine Fassung liegt in der Zwischenablage',
  'gh.someone': 'Jemand', 'gh.discardAsk': 'Deine Änderungen an {name} verwerfen?', 'gh.leaveAsk': 'Es gibt nicht gespeicherte Änderungen.',
  'gh.adminTitle': 'Admin · Rechte pro Bereich', 'gh.adminLead': 'Rechte gelten immer für einen ganzen Bereich. Was du hier änderst, wird direkt bei GitHub geändert.',
  'gh.areas': 'Bereiche', 'gh.people': 'Personen', 'gh.teams': 'Teams', 'gh.invites': 'Offene Einladungen', 'gh.invite': 'Einladen', 'gh.invitePh': 'GitHub-Benutzername',
  'gh.remove': 'Entfernen', 'gh.removeAsk': '{who} aus {area} entfernen?', 'gh.revoke': 'Zurückziehen',
  'gh.role.pull': 'Lesen', 'gh.role.triage': 'Kommentieren', 'gh.role.push': 'Bearbeiten', 'gh.role.maintain': 'Verwalten', 'gh.role.admin': 'Admin', 'gh.role.none': 'Kein Zugriff',
  'gh.personal': 'Dieser Bereich gehört einem persönlichen Konto. Dort dürfen Eingeladene immer bearbeiten. Für reine Leserechte und Teams muss der Bereich in einem Workspace liegen.',
  'gh.noAdmin': 'Du bist in keinem Bereich Admin.', 'gh.newArea': 'Neuer Bereich', 'gh.newAreaPh': 'Name, z. B. marketing', 'gh.create': 'Anlegen',
  'gh.created': 'Bereich {name} angelegt', 'gh.changed': 'Bei GitHub geändert', 'gh.invited': '{who} eingeladen', 'gh.failed': 'GitHub meldet: {msg}',
  'gh.startTitle': 'In 2 Minuten loslegen', 'gh.startText': 'Zwei Schritte bei GitHub, den Rest richtet natively selbst ein.',
  'gh.step1': 'Organisation bei GitHub anlegen', 'gh.step1Text': 'Eure Firma bekommt bei GitHub eine eigene, kostenlose Organisation. Nur dort gibt es Teams und reine Leserechte. Plan „Free“ wählen.',
  'gh.step1Btn': 'Organisation anlegen', 'gh.step1Have': 'Haben wir schon', 'gh.step1Done': 'Erledigt. Falls nicht, nochmal öffnen.',
  'gh.step2': 'natively in der Organisation freischalten', 'gh.step2Text': 'Bei GitHub eure Organisation wählen, „All repositories“ und Install. Danach bist du sofort wieder hier und richtest den Workspace mit einem Klick ein.',
  'gh.tryPersonal': 'Nur allein ausprobieren? natively auf deinem eigenen Konto installieren', 'gh.firstOrg': 'Für ein Team mit Teams und reinen Leserechten zuerst eine Organisation anlegen.',
  'gh.start': 'natively freischalten', 'gh.firstTitle': 'Ersten Bereich anlegen', 'gh.firstText': 'natively ist für {who} eingerichtet. Ein Bereich ist ein Ordner mit eigenen Rechten, z. B. für das ganze Team.', 'gh.first': 'Ersten Bereich „wissen“ anlegen',
  'gh.org': 'Workspace', 'gh.orgLead': 'Alle in eurem Workspace. Rechte kommen über Teams: Wer in einem Team ist, bekommt genau die Bereiche dieses Teams.', 'gh.loading': 'Lade …',
  'gh.baseWarn': 'Achtung: Gerade haben alle Mitglieder in jedem Bereich das Recht „{role}“. Für Rechte pro Bereich bei GitHub „Base permissions“ auf „No permission“ stellen.', 'gh.baseFix': 'Bei GitHub ändern',
  'gh.requests': 'Zugriffsanfragen', 'gh.reqLine': '{who} möchte {role} in {area}', 'gh.approve': 'Genehmigen', 'gh.reject': 'Ablehnen', 'gh.approved': 'Genehmigt, Rechte bei GitHub gesetzt', 'gh.rejected': 'Abgelehnt',
  'gh.approvedBy': 'Genehmigt von {who}', 'gh.rejectedBy': 'Abgelehnt von {who}', 'gh.noArea': 'Einen Bereich „{area}“ gibt es nicht', 'gh.noTeam': 'kein Team', 'gh.noTeams': 'Noch keine Teams. Teams bei GitHub anlegen, z. B. „Marketing“.',
  'gh.teamEmpty': 'noch niemand', 'gh.addPerson': '+ Person hinzufügen', 'gh.orgRemove': 'Aus dem Workspace entfernen', 'gh.orgRemoveAsk': '{who} aus dem Workspace {org} entfernen? Die Person verliert alle Rechte in allen Bereichen.',
  'gh.outside': 'Externe', 'gh.orgInvitePh': 'GitHub-Benutzername oder E-Mail',
  'gh.reqBtn': 'Zugriff anfragen', 'gh.reqTitle': 'Zugriff anfragen', 'gh.reqText': 'Deine Admins sehen die Anfrage in natively und können sie mit einem Klick genehmigen.',
  'gh.reqAreaPh': 'Welcher Bereich? z. B. marketing', 'gh.reqWhyPh': 'Warum? (optional)', 'gh.reqSend': 'Anfrage senden', 'gh.reqSent': 'Anfrage an deine Admins geschickt',
  'gh.reqNoOrg': 'Du bist noch in keinem Workspace. Frag deinen Admin direkt.', 'gh.reqNoAreaName': 'Bitte den Bereich eintragen', 'gh.reqHow': 'Admins genehmigen oder lehnen das in natively unter Admin → Workspace ab.',
  'gh.timeline': 'Verlauf', 'gh.today': 'Heute', 'gh.yesterday': 'Gestern', 'gh.tl.changed': 'hat {what} geändert', 'gh.tl.added': 'hat {what} angelegt', 'gh.tl.removed': 'hat {what} gelöscht', 'gh.tl.for': 'für {who}',
  'gh.tl.noLines': 'Keine Textzeilen geändert.', 'gh.tl.more': '{n} weitere Zeilen', 'gh.tl.openVersion': 'Diese Version öffnen', 'gh.tl.openFile': 'Datei öffnen', 'gh.tl.view': 'Ansehen',
  'gh.tl.noRights': 'Kein Zugriff auf den Verlauf von {area}.', 'gh.tl.emptyArea': '{area} hat noch keine Versionen.', 'gh.tl.searchPh': 'Datei, Person oder Beschreibung suchen', 'gh.tl.person': 'Person', 'gh.tl.allPeople': 'Alle Personen',
  'gh.tl.area': 'Bereich', 'gh.tl.allAreas': 'Alle Bereiche', 'gh.tl.range': 'Zeitraum', 'gh.tl.rangeAll': 'Gesamter Zeitraum', 'gh.tl.range7': 'Letzte 7 Tage', 'gh.tl.range30': 'Letzte 30 Tage', 'gh.tl.layout': 'Ansicht',
  'gh.tl.asTimeline': 'Zeitleiste', 'gh.tl.asTable': 'Tabelle', 'gh.tl.noMatch': 'Nichts passt zu diesen Filtern.', 'gh.tl.none': 'Noch keine Änderungen.', 'gh.tl.colTime': 'Wann', 'gh.tl.colFile': 'Datei', 'gh.tl.colChange': 'Änderung',
  'gh.tl.wasChanged': 'geändert', 'gh.tl.wasAdded': 'angelegt', 'gh.tl.wasRemoved': 'gelöscht', 'gh.tl.count': '{n} Änderungen geladen', 'gh.tl.loadMore': 'Mehr laden',
  'gh.tl.leadAll': 'Wer hat was geändert, in allen Bereichen, die du sehen darfst. Direkt aus den Versionen bei GitHub.', 'gh.tl.leadArea': 'Jede Änderung in diesem Bereich, die neueste zuerst.', 'gh.tl.leadFile': 'Jede Version dieser Datei. Jede lässt sich öffnen oder wiederherstellen.',
  'gh.tl.restoreShort': 'Wiederherstellen', 'gh.tl.isCurrent': 'Das ist die aktuelle Fassung', 'gh.tl.fileGone': 'Diese Datei gibt es nicht mehr.', 'gh.tl.restored': 'Als neue Version wiederhergestellt',
  'gh.offline': 'Keine Verbindung', 'gh.restored': '{n} nicht gespeicherte Änderung(en) wiederhergestellt, wird gespeichert', 'gh.lastBy': 'Zuletzt geändert von {who} · {when}', 'gh.lastAt': 'Zuletzt geändert {when}',
  'gh.versions': 'Versionen', 'gh.versionsOf': 'Versionen · {name}', 'gh.current': 'aktuell', 'gh.sameAsNow': 'Gleich wie die aktuelle Version.', 'gh.restore': 'Diese Version wiederherstellen',
  'gh.restoreAsk': 'Diese Version wiederherstellen? Sie wird als neue Version gespeichert, nichts wird gelöscht.', 'gh.restoreMsg': '{who} hat {name} auf die Version vom {when} zurückgesetzt (natively)',
  'gh.diffTitle': 'Unterschiede zu jetzt', 'gh.diffLegend': 'Rot stand in dieser Version, grün ist seitdem neu.', 'gh.tooLong': 'Datei zu lang für einen Vergleich.', 'gh.created0': 'Hier wurde die Datei angelegt.',
  'gh.commitMsg': '{who} hat {name} bearbeitet (natively)', 'gh.updated': '„{name}“ wurde gerade von {who} aktualisiert', 'gh.recentTeam': 'Zuletzt geändert im Team',
  'gh.st.pending': 'Änderungen …', 'gh.st.saving': 'Speichert …', 'gh.st.saved': 'Gespeichert', 'gh.st.retry': 'Nicht gespeichert, wird erneut versucht', 'gh.st.auth': 'Anmeldung abgelaufen, dein Text ist sicher', 'gh.st.conflict': 'Nicht gespeichert: Jemand anderes hat die Datei geändert',
  'gh.signoutAsk': 'Einige Änderungen sind noch nicht gespeichert. Sie bleiben in diesem Browser für dein Konto. Trotzdem abmelden?', 'gh.dropMine': 'Meine verwerfen (in die Zwischenablage)', 'gh.recreate': 'Datei mit meinem Text neu anlegen', 'gh.show': 'Ansehen', 'gh.signinAgain': 'Neu anmelden', 'gh.tryNow': 'Jetzt versuchen', 'gh.later': 'Später', 'gh.conflictSafe': 'Dein Text bleibt in diesem Browser gesichert, bis du entscheidest.',
  'gh.invitedTo': 'Du wurdest in den Workspace {org} eingeladen', 'gh.joinText': 'Mit einem Klick beitreten, dann siehst du alle Bereiche deines Teams.', 'gh.join': 'Workspace beitreten', 'gh.joined': 'Willkommen im Workspace {org}',
  'gh.joinOnGitHub': 'Bitte die Einladung in den Workspace {org} bei GitHub annehmen und dann zurückkommen.', 'gh.setupTitle': 'Workspace {org} einrichten', 'gh.setupText': 'Ein Klick: natively schaltet das Leserecht für alle ab, legt das Team „Alle“ und den Bereich „wissen“ mit Startseite und Regeln für Claude an.',
  'gh.setup': 'Workspace einrichten', 'gh.settingUp': 'Richte ein …', 'gh.setupDone': '{org} ist startklar.', 'gh.setupBaseManual': 'Das Grundrecht konnte nicht geändert werden, siehe Admin.',
  'gh.claude': 'Claude verbinden', 'gh.claudeCopied': 'Adresse kopiert', 'gh.openMissing': 'Diese Datei gibt es nicht, oder du hast keinen Zugriff darauf.', 'gh.cl.s4': 'Optional: In Claude beim Connector natively die Werkzeuge auf <b>Always allow</b> (Immer erlauben) stellen. Dann fragt Claude nicht mehr vor jedem Schritt.', 'gh.cl.text': 'Einmal einrichten, danach speichert Claude direkt in natively.', 'gh.cl.s1': '<b>Adresse kopieren</b>', 'gh.cl.s2': 'Claude öffnen: <b>Customize → Connectors</b>, auf <b>+</b> klicken und <b>Add custom connector</b> (Benutzerdefinierten Connector hinzufügen) wählen.', 'gh.cl.s3': 'Name <code>natively</code>, Adresse einfügen, <b>Add</b> klicken, dann <b>Connect</b> und mit GitHub anmelden.', 'gh.cl.team': 'Claude Team oder Enterprise: Ein Owner fügt den Connector einmal unter Organisationseinstellungen → Connectors hinzu. Danach klickt jede Person nur noch auf Connect.', 'gh.cl.copy': 'Kopieren', 'gh.cl.open': 'Claude öffnen', 'gh.cl.admin': 'Organisationseinstellungen', 'gh.cl.help': 'Hilfe von Claude', 'gh.baseFixNow': 'Jetzt beheben', 'gh.invitedLink': '{who} eingeladen. Link kopiert, schick ihn der Person: {link}',
  'gh.yourRole': 'Deine Rolle', 'gh.files': 'Dateien', 'gh.members': 'Mitglieder', 'gh.owner': 'Inhaber'
});

/* ---------- GitHub-Zugriff ---------- */
class GhError extends Error { constructor(status, msg){ super(msg); this.status = status; } }
async function refreshToken(){
  if (!auth || !auth.refresh) return false;
  try {
    const r = await fetch('/api/auth/refresh', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ refresh_token:auth.refresh }) });
    const j = await r.json();
    if (!r.ok || !j.access_token) return false;
    saveAuth(j);
    return true;
  } catch(e) { return false; }
}
function saveAuth(j){
  auth = { token:j.access_token, refresh:j.refresh_token || (auth && auth.refresh) || null, exp:j.expires_in ? Date.now() + j.expires_in * 1000 : 0 };
  write(AUTH_KEY, auth);
}
let authExpired = false;
/* GitHub-Anfrage. Wirft GhError mit status (0 = offline). opt.etag → 304 erlaubt, opt.raw → { status, etag, json } */
async function gh(path, opt = {}){
  if (!auth) throw new GhError(401, T('gh.expired'));
  if (auth.exp && Date.now() > auth.exp - 60000) await refreshToken();
  const url = /^https?:/.test(path) ? path : API + path;
  const go = () => fetch(url, { method:opt.method || 'GET', body:opt.body ? JSON.stringify(opt.body) : undefined, cache:'no-store', keepalive:!!opt.keepalive, headers:{
    accept:'application/vnd.github+json', 'x-github-api-version':'2022-11-28',
    ...(auth ? { authorization:'Bearer ' + auth.token } : {}), ...(opt.body ? { 'content-type':'application/json' } : {}), ...(opt.etag ? { 'if-none-match':opt.etag } : {}) } });
  let r;
  try { r = await go(); } catch(e) { throw new GhError(0, T('gh.offline')); }
  if (r.status === 401 && await refreshToken()) { try { r = await go(); } catch(e) { throw new GhError(0, T('gh.offline')); } }
  if (r.status === 401) { authExpired = true; throw new GhError(401, T('gh.expired')); }
  authExpired = false;
  if (r.status === 304) return opt.raw ? { status:304, etag:opt.etag, json:null } : null;
  if (!r.ok) { let j = {}; try { j = await r.json(); } catch(e) {} throw new GhError(r.status, j.message || r.statusText); }
  const json = r.status === 204 ? null : await r.json().catch(() => null);
  return opt.raw ? { status:r.status, etag:r.headers.get('etag'), json } : json;
}
async function gql(query, variables){
  const j = await gh(GQL, { method:'POST', body:{ query, variables } });
  if (j && j.errors && j.errors.length) throw new GhError(422, j.errors[0].message);
  return j && j.data;
}
async function ghAll(path, key){
  const out = [];
  for (let page = 1; page < 50; page++) {
    const j = await gh(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
    const list = key ? j[key] : j;
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}
async function pool(items, n, fn){
  const out = new Array(items.length); let k = 0;
  await Promise.all(Array.from({ length:Math.min(n, items.length) }, async () => { while (k < items.length) { const i = k++; out[i] = await fn(items[i], i); } }));
  return out;
}
const fromB64 = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
function toB64(s){
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
/* Git-SHA eines Textes, wie GitHub sie berechnet: sha1("blob <Bytes>\0<Inhalt>") */
async function blobSha(text){
  const body = new TextEncoder().encode(text), head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length); all.set(head); all.set(body, head.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const roleOf = p => !p ? 'none' : p.admin ? 'admin' : p.maintain ? 'maintain' : p.push ? 'push' : p.triage ? 'triage' : p.pull ? 'pull' : 'none';
const canWrite = r => r && r.permissions && (r.permissions.push || r.permissions.admin);
const srcId = r => 'gh-' + r.full_name;
const repoOf = srcIdOrFile => { const id = typeof srcIdOrFile === 'string' ? srcIdOrFile : srcIdOrFile.src; return repos.find(r => srcId(r) === id); };

/* ---------- Laden: Repos → Bäume → Inhalte → Datum ---------- */
async function loadRepos(){
  me = await gh('/user');
  const inst = await gh('/user/installations?per_page=100');
  installs = (inst.installations || []).map(i => ({ login:i.account.login, type:i.account.type }));
  const list = [];
  for (const i of inst.installations || []) list.push(...await ghAll(`/user/installations/${i.id}/repositories`, 'repositories'));
  const seen = new Set();
  repos = list.filter(r => !seen.has(r.full_name) && seen.add(r.full_name)).sort((a, b) => a.full_name.localeCompare(b.full_name));
}
const heads = {};   // full_name → { sha, etag }: letzter bekannter Stand des Branches
async function headOf(r, useEtag){
  const h = heads[r.full_name] || {};
  const res = await gh(`/repos/${r.full_name}/git/ref/heads/${encodeURIComponent(r.default_branch)}`, { raw:true, etag:useEtag ? h.etag : null });
  if (res.status === 304) return { sha:h.sha, same:true };
  return { sha:res.json.object.sha, etag:res.etag, same:false };
}
async function loadTree(r, commitSha){
  const tree = await gh(`/repos/${r.full_name}/git/trees/${commitSha}?recursive=1`);
  return (tree.tree || []).filter(x => x.type === 'blob' && MD.test(x.path) && !x.path.split('/').some(s => s.startsWith('.') || SKIP.has(s)));
}
async function loadRepoFiles(r){
  let head;
  try { head = await headOf(r, false); }
  catch(e) { if (e.status === 409 || e.status === 404) return []; throw e; }
  heads[r.full_name] = { sha:head.sha, etag:head.etag };
  const items = await loadTree(r, head.sha);
  await fetchBlobs(r, items);
  await loadDates(r, items);
  return items.map(x => makeFile(r, x));
}
const dateOf = sha => { const d = dates[sha]; return !d ? null : typeof d === 'string' ? { at:d } : d; };
function makeFile(r, x){
  const id = srcId(r) + '|' + x.path;
  const iso = (dateOf(x.sha) || {}).at || r.pushed_at || new Date().toISOString();
  const f = { id, src:srcId(r), path:x.path.split('/'), abs:'/' + r.full_name + '/' + x.path, mod:day(iso), ts:Date.parse(iso) / 1000,
    size:x.size, sha:x.sha, content:x.size > 1000000 ? null : blobs[x.sha], cloud:false };
  if (dirty[id]) f.content = dirty[id].draft;
  return f;
}
async function fetchBlobs(r, items){
  await pool(items.filter(x => blobs[x.sha] == null && x.size <= 1000000), 8, async x => {
    const b = await gh(`/repos/${r.full_name}/git/blobs/${x.sha}`);
    blobs[x.sha] = fromB64(b.content || '');
  });
}
/* Letzte Änderung pro Datei: eine GraphQL-Abfrage pro 60 Dateien, gemerkt pro Dateiversion (sha) */
async function loadDates(r, items){
  const todo = items.filter(x => { const d = dateOf(x.sha); return !d || !d.who; });
  for (let i = 0; i < todo.length; i += 60) {
    const chunk = todo.slice(i, i + 60);
    const q = `query{repository(owner:${JSON.stringify(r.owner.login)},name:${JSON.stringify(r.name)}){object(expression:${JSON.stringify(r.default_branch)}){...on Commit{${chunk.map((x, k) => `f${k}:history(first:1,path:${JSON.stringify(x.path)}){nodes{committedDate author{name user{login}}}}`).join(' ')}}}}}`;
    try {
      const j = await gh(GQL, { method:'POST', body:{ query:q } });
      const obj = j && j.data && j.data.repository && j.data.repository.object;
      chunk.forEach((x, k) => { const n = obj && obj['f' + k] && obj['f' + k].nodes[0]; if (n) dates[x.sha] = { at:n.committedDate, who:(n.author && (n.author.name || (n.author.user && n.author.user.login))) || '' }; });
    } catch(e) { break; }
  }
}
function saveCaches(){
  const used = new Set(data.files.map(f => f.sha));
  const prune = o => Object.fromEntries(Object.entries(o).filter(([k]) => used.has(k)));
  blobs = prune(blobs); dates = prune(dates);
  write(BLOB_KEY, blobs); write(DATE_KEY, dates);
}
async function scan(){
  if (!auth) { data = { sources:[], files:[], home:'' }; return data; }
  await loadRepos();
  const lists = await pool(repos, 4, r => loadRepoFiles(r).catch(e => { console.warn(r.full_name, e); return []; }));
  const multiOwner = new Set(repos.map(r => r.owner.login)).size > 1;
  const sources = repos.map(r => ({ id:srcId(r), name:multiOwner ? r.full_name : r.name, icon:r.private ? 'drive' : 'cloud', root:r.full_name + ' · ' + T('gh.role.' + roleOf(r.permissions)),
    abs:'/' + r.full_name, hidden:[], hiddenCount:0, custom:false }));
  const files = [].concat(...lists);
  data = { home:'', sources, files };
  saveCaches();
  await Promise.all([loadAccess(), loadOrgRoles(), loadPending()]);
  data.sources.unshift({ id:OVERVIEW, fixed:true, name:LANG === 'de' ? 'Übersicht' : 'Overview', icon:'logo', root:LANG === 'de' ? 'Aufbau und Rechte, live von GitHub' : 'Structure and rights, live from GitHub', abs:'/natively', hidden:[], hiddenCount:0, custom:false });
  data.files.unshift(overviewFile());
  restoreDrafts();
  clearInterval(restoreTimer); restoreTimer = setInterval(() => restoreDrafts(true), 60000);   // Entwürfe aus abgestürzten Tabs
  refreshRecent();
  startPolling();
  // Beim ersten Anmelden direkt die Übersicht öffnen: dort steht, wie es losgeht
  if (!read('natively:gh:welcomed')) { write('natively:gh:welcomed', 1); setTimeout(() => ui() && ui().openFile(OVERVIEW + '|aufbau-und-rechte.md', { pin:true }), 50); }
  const want = takeOpen(); if (want) setTimeout(() => openWanted(want), 120);   // Link aus Claude
  return data;
}

/* ---------- Übersicht „Aufbau und Rechte“: die Datei, die jeder zuerst lesen soll ---------- */
async function loadAccess(){
  await pool(repos, 4, async r => {
    const a = access[r.full_name] = { people:[], teams:[], invites:[], error:null };
    if (!canWrite(r)) return;
    try { a.people = await ghAll(`/repos/${r.full_name}/collaborators?affiliation=all`); } catch(e) { a.error = e.message; }
    if (r.owner.type === 'Organization') { try { a.teams = await ghAll(`/repos/${r.full_name}/teams`); } catch(e) {} }
    if (r.permissions.admin) { try { a.invites = await ghAll(`/repos/${r.full_name}/invitations`); } catch(e) {} }
  });
}
function overviewFile(){
  const de = LANG === 'de';
  const role = k => T('gh.role.' + k);
  const L = [];
  L.push(de ? '# Aufbau und Rechte' : '# Structure and rights', '');
  L.push(de ? `So ist euer Wissen aufgeteilt und wer was darf. Stand: ${new Date().toLocaleDateString('de-DE')}, live von GitHub. Diese Seite erstellt natively automatisch, sie ist immer aktuell.`
            : `How your knowledge is split up and who may do what. As of ${new Date().toLocaleDateString('en-US')}, live from GitHub. natively creates this page automatically, it is always up to date.`, '');
  L.push(de ? '## So legst du los' : '## Getting started', '');
  L.push(de ? '| Schritt | So geht’s |' : '| Step | How |', '| --- | --- |');
  L.push(de ? `| **1. Bereich anlegen** | ${repos.length ? 'Startseite → Admin → Neuer Bereich' : 'Startseite → **Organisation anlegen** (kostenlos bei GitHub, Plan „Free“) → **natively freischalten**: bei GitHub die Organisation wählen, Install → zurück in natively **Workspace einrichten**. Alles andere stellt natively selbst ein.'} |`
            : `| **1. Create an area** | ${repos.length ? 'Home → Admin → New area' : 'Home → **Create organisation** (free on GitHub, “Free” plan) → **Allow natively**: pick the organisation on GitHub, Install → back in natively click **Set up workspace**. natively sets up everything else.'} |`);
  L.push(de ? '| **2. Leute einladen** | Admin → Workspace → GitHub-Name oder E-Mail → Einladen. natively kopiert einen Link, den du der Person schickst. Sie meldet sich an und ist drin. |'
            : '| **2. Invite people** | Home → Admin → enter GitHub username, choose role, Invite. They need a free GitHub account. |');
  L.push(de ? '| **3. Claude verbinden** | Startseite → **Claude verbinden** zeigt die drei Schritte: Adresse kopieren, in Claude unter **Customize → Connectors** einen **benutzerdefinierten Connector** hinzufügen, mit dem eigenen GitHub-Konto anmelden. Claude speichert dann immer direkt in natively. Dann z. B.: „Leg in wissen eine Datei zum Onboarding an.“ Claude sieht nur, was du sehen darfst. |'
            : '| **3. Connect Claude** | Home → **Connect Claude** shows three steps: copy the address, add a **custom connector** in Claude under **Customize → Connectors**, sign in with your own GitHub account. Claude then always saves straight into natively. Then e.g.: “Create an onboarding file in wissen.” Claude only sees what you may see. |');
  L.push(de ? '| **Zugriff anfragen** | Startseite → **Zugriff anfragen**, oder Claude bitten: „Leg im Bereich wissen ein Issue „[Zugriff] mein-name: Bearbeiten in marketing“ an.“ Admins genehmigen unter Admin → Workspace. |'
            : '| **Request access** | Home → **Request access**, or ask Claude: “Create an issue “[Zugriff] my-name: Edit in marketing” in the area wissen.” Admins approve under Admin → Workspace. |', '');
  L.push(de ? '## Das Wichtigste' : '## The one thing to learn', '');
  L.push(de ? '- **Ein Bereich = ein Repository bei GitHub.** Rechte gelten immer für den ganzen Bereich mit allen Ordnern darin.' : '- **One area = one repository on GitHub.** Rights always apply to the whole area with all its folders.');
  L.push(de ? '- Wer einen Bereich nicht sehen darf, sieht ihn auch hier nicht. Auch eine AI wie Claude sieht nur, was dein GitHub-Zugang sehen darf.' : '- If you may not see an area, you will not see it here. An AI like Claude also only sees what your GitHub access may see.');
  L.push(de ? '- Rechte vergeben Admins im Admin-Bereich von natively, direkt bei GitHub oder indem sie Claude darum bitten.' : '- Admins assign rights in the natively admin area, directly on GitHub, or by asking Claude.', '');
  L.push(de ? '| Stufe | Darf im ganzen Bereich |' : '| Level | May, in the whole area |', '| --- | --- |');
  L.push(`| ${role('none')} | ${de ? 'den Bereich nicht sehen' : 'not see the area'} |`);
  L.push(`| **${role('pull')}** | ${de ? 'alles lesen und durchsuchen' : 'read and search everything'} |`);
  L.push(`| ${role('triage')} | ${de ? 'lesen, später auch kommentieren' : 'read, later also comment'} |`);
  L.push(`| **${role('push')}** | ${de ? 'alles lesen und ändern, jede Änderung wird eine Version' : 'read and change everything, every change becomes a version'} |`);
  L.push(`| **${role('admin')}** | ${de ? 'dazu Leute einladen und Rechte vergeben' : 'also invite people and assign rights'} |`, '');
  L.push(de ? '## Bereiche' : '## Areas', '');
  L.push(`| ${de ? 'Bereich' : 'Area'} | ${T('gh.yourRole')} | ${T('gh.files')} | ${T('gh.members')} |`, '| --- | --- | --- | --- |');
  for (const r of repos) {
    const n = data.files.filter(f => f.src === srcId(r)).length;
    const a = access[r.full_name] || {};
    L.push(`| **${r.name}**${r.owner.type === 'User' ? ' (' + r.owner.login + ')' : ''} | ${role(roleOf(r.permissions))} | ${n} | ${canWrite(r) ? (a.people || []).length : '–'} |`);
  }
  if (!repos.length) L.push(`| – | – | – | – |`);
  for (const r of repos) {
    const a = access[r.full_name];
    L.push('', `## ${r.name}`, '');
    if (!a || !canWrite(r)) { L.push(de ? `Deine Rolle: **${role(roleOf(r.permissions))}**. Wer sonst Zugriff hat, sehen nur Personen mit Bearbeiten oder Admin.` : `Your role: **${role(roleOf(r.permissions))}**. Only people with Edit or Admin can see who else has access.`); continue; }
    if (a.teams.length) {
      L.push(`| ${T('gh.teams')} | ${de ? 'Rolle' : 'Role'} |`, '| --- | --- |');
      a.teams.forEach(tm => L.push(`| ${tm.name} | ${role(tm.permission)} |`));
      L.push('');
    }
    L.push(`| ${T('gh.people')} | ${de ? 'Rolle' : 'Role'} |`, '| --- | --- |');
    a.people.forEach(p => L.push(`| ${p.login}${p.login === r.owner.login ? ' · ' + T('gh.owner') : ''} | ${role(roleKey(p))} |`));
    a.invites.forEach(i => L.push(`| ${i.invitee ? i.invitee.login : i.email} · ${de ? 'eingeladen' : 'invited'} | ${role(i.permissions === 'write' ? 'push' : i.permissions === 'read' ? 'pull' : i.permissions)} |`));
    if (r.owner.type === 'User') L.push('', '> ' + T('gh.personal'));
  }
  const content = L.join('\n') + '\n';
  return { id:OVERVIEW + '|aufbau-und-rechte.md', src:OVERVIEW, path:[de ? 'aufbau-und-rechte.md' : 'structure-and-rights.md'], abs:'/natively/aufbau-und-rechte.md', mod:today(), ts:Date.now() / 1000, size:content.length, content, cloud:false, virtual:true };
}
const roleKey = p => p.role_name ? ({ read:'pull', write:'push', triage:'triage', maintain:'maintain', admin:'admin' }[p.role_name] || p.role_name) : roleOf(p.permissions);

/* ---------- Brücke native(cmd, arg) ---------- */
async function cmd(c, arg){
  switch (c) {
    case 'scan': case 'rescan':
      try { return JSON.stringify(await scan()); }
      catch(e) {
        if (e.status === 401) { signOut(true); return JSON.stringify(data); }
        if (e.status === 0) { retryScan(); throw e; }   // offline: von selbst neu laden, sobald es wieder geht
        throw e;
      }
    case 'prefs.get': return JSON.stringify(read(PREF_KEY) || {});
    case 'prefs.set': try { localStorage.setItem(PREF_KEY, arg); } catch(e) {} return true;
    case 'log': console.warn('natively:', arg); return true;
    case 'reveal': case 'openExternal': { const u = ghUrl(arg); if (u) window.open(u, '_blank', 'noopener'); return true; }
    case 'openURL': if (/^(https?:|mailto:)/i.test(String(arg || ''))) window.open(arg, '_blank', 'noopener'); return true;
    case 'copy': await navigator.clipboard.writeText(String(arg)); return true;
    case 'info': return 'null';
    case 'isDefault': case 'ready': case 'title': case 'drag': case 'download': return true;
    default: throw new Error(c + ': ' + T('err.macOnly'));
  }
}
/* "/owner/repo/a/b.md" → Link auf github.com */
function ghUrl(abs){
  if (!abs) return '';
  const m = String(abs).match(/^\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (!m) return '';
  const r = repos.find(x => x.full_name === m[1] + '/' + m[2]);
  if (!r) return '';
  if (!m[3]) return r.html_url;
  return `${r.html_url}/${MD.test(m[3]) ? 'blob' : 'tree'}/${encodeURIComponent(r.default_branch)}/${encPath(m[3])}`;
}

/* ---------- Anmelden ---------- */
function signIn(){ leaving = true; persistDrafts(); location.href = '/api/auth/login?back=' + encodeURIComponent(location.pathname); }
function signOut(expired){
  if (!expired && Object.keys(dirty).length && !confirm(T('gh.signoutAsk'))) return;
  auth = null; write(AUTH_KEY, null); write(BLOB_KEY, null); write(DATE_KEY, null);
  me = null; repos = []; data = { sources:[], files:[], home:'' }; clearInterval(pollTimer);
  if (ui()) ui().apply({ full:data });
  if (expired && ui()) ui().toast(T('gh.expired'));
}
/* Ohne Installation: erst Organisation bei GitHub anlegen, dann natively dort freischalten. Danach erscheint „Workspace einrichten“. */
const ORG_STEP = 'natively:orgStep';
const NEW_ORG_URL = 'https://github.com/account/organizations/new?plan=free';
function startSteps(){
  const done = read(ORG_STEP) === 1;
  const step = (n, ok, title, text, action) => `<div class="step${ok ? ' done' : ''}"><span class="num">${ok ? icon('check') : n}</span>
      <span class="txt"><span class="nm">${E(title)}</span><span class="pth">${E(text)}</span></span>${action}</div>`;
  return `<div class="gh-start"><b>${E(T('gh.startTitle'))}</b><p>${E(T('gh.startText'))}</p></div>
    <div class="setup gh-steps">
    ${step(1, done, T('gh.step1'), done ? T('gh.step1Done') : T('gh.step1Text'),
      `<span class="acts"><button class="btn${done ? '' : ' primary'}" data-gh="neworg">${icon('out')}${E(T('gh.step1Btn'))}</button>${done ? '' : `<button class="btn" data-gh="orgdone">${E(T('gh.step1Have'))}</button>`}</span>`)}
    ${step(2, false, T('gh.step2'), T('gh.step2Text'), `<button class="btn${done ? ' primary' : ''}" data-gh="start">${E(T('gh.start'))}</button>`)}
    <div class="gh-start gh-try"><button class="link" data-gh="start">${E(T('gh.tryPersonal'))}</button></div>
    </div>`;
}
function orgStepDone(){ write(ORG_STEP, 1); const t = ui() && ui().curTab(); if (t && !t.file && !t.dir && !t.view) ui().render(); }
function card(){
  if (!auth) return `<section class="card gh-card"><div class="gh-signin">
      <svg class="i gh-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 0 0-2.7 16.57c.43.08.58-.18.58-.4v-1.5c-2.36.5-2.86-1.01-2.86-1.01-.39-.98-.95-1.24-.95-1.24-.77-.53.06-.52.06-.52.85.06 1.3.88 1.3.88.76 1.3 1.99.92 2.47.7.08-.55.3-.92.54-1.13-1.89-.21-3.87-.94-3.87-4.2 0-.93.33-1.69.88-2.28-.09-.22-.38-1.08.08-2.25 0 0 .72-.23 2.34.87a8.1 8.1 0 0 1 4.26 0c1.62-1.1 2.34-.87 2.34-.87.46 1.17.17 2.03.08 2.25.55.59.88 1.35.88 2.28 0 3.27-1.99 3.99-3.88 4.2.3.26.58.78.58 1.57v2.33c0 .22.15.49.59.4A8.5 8.5 0 0 0 12 3.5z"/></svg>
      <p>${E(T('gh.signinText'))}</p>
      <button class="btn primary" data-gh="signin">${E(T('gh.signin'))}</button></div></section>`;
  const adminAny = repos.some(r => r.permissions && r.permissions.admin) || adminOrgs().length;
  const org0 = installs.find(i => i.type === 'Organization' && orgInfo[i.login] && orgInfo[i.login].admin && !repos.some(r => r.owner.login === i.login));
  const join = pending.map(o => `<div class="gh-start"><b>${E(T('gh.invitedTo', { org:o }))}</b><p>${E(T('gh.joinText'))}</p><button class="btn primary" data-gh="join" data-org="${E(o)}">${E(T('gh.join', { org:o }))}</button></div>`).join('');
  const setup = org0 ? `<div class="gh-start"><b>${E(T('gh.setupTitle', { org:org0.login }))}</b><p>${E(T('gh.setupText'))}</p><button class="btn primary" data-gh="setup" data-org="${E(org0.login)}">${E(T('gh.setup', { org:org0.login }))}</button></div>` : '';
  const none = join || setup || (repos.length ? '' : !installs.length ? startSteps()
    : `<div class="gh-start"><b>${E(T('gh.firstTitle'))}</b><p>${E(T('gh.firstText', { who:installs[0].login }))}</p><button class="btn primary" data-gh="first">${E(T('gh.first'))}</button>
       ${installs.some(i => i.type === 'Organization') ? '' : `<p class="gh-sub">${E(T('gh.firstOrg'))} <button class="link" data-gh="neworg">${E(T('gh.step1Btn'))} ↗</button></p>`}</div>`);
  return `<section class="card gh-card"><div class="gh-row">
      ${me ? `<img class="gh-ava" src="${E(me.avatar_url)}&s=64" alt="">` : ''}<span class="txt">${E(T('gh.signedIn', { who:me ? me.login : '…' }))}</span>
      ${adminAny ? `<button class="btn" data-gh="admin">${icon('sliders')}${E(T('gh.admin'))}</button>` : ''}
      <button class="btn" data-gh="claude">${icon('link')}${E(T('gh.claude'))}</button>
      ${repos.length ? `<button class="btn" data-gh="request">${icon('folder-plus')}${E(T('gh.reqBtn'))}</button>` : ''}
      <button class="btn" data-gh="install">${icon('out')}GitHub</button>
      <button class="btn" data-gh="signout">${E(T('gh.signout'))}</button></div>${none}</section>`;
}

/* ---------- Editor: in einen Absatz klicken und tippen. natively speichert selbst (Autosave). ----------
   Robustheit:
   - Jeder Zwischenstand liegt sofort im Browser (localStorage, pro Tab). Nach Absturz, Offline oder abgelaufener Anmeldung wird er wiederhergestellt.
   - Speichern ~2 s nach dem letzten Tippen. Eine Bearbeitungs-Sitzung = eine Version: solange man weiterarbeitet (< 5 min Pause) und
     niemand anderes dazwischen gespeichert hat, wird die eigene letzte Version ersetzt (atomar über updateRefs mit beforeOid), sonst neue Version.
   - Nie überschreiben: jede Änderung schickt die bekannte SHA mit. Hat jemand anderes geändert → Konflikt, Text bleibt sicher.
   - Fehler (offline, Server, Anmeldung) → Entwurf bleibt, erneuter Versuch mit Pause (3 s … 60 s), sofort wieder bei „online“ oder Fokus. */
const SAVE_DELAY = 2000, SESSION_IDLE = 5 * 60 * 1000, POLL_EVERY = 45000;
const DRAFT_KEY = 'natively:gh:drafts', TABS_KEY = 'natively:gh:tabs';
const TAB_DEAD = 3 * 60 * 1000;   // Hintergrund-Tabs schlagen nur ~1×/min (Browser drosseln). Normales Schließen meldet sich sofort ab (pagehide).
const TAB = Math.random().toString(36).slice(2, 10);
const sessions = {};   // Datei-ID → { commit, parent, last }: die Version dieser Bearbeitungs-Sitzung
let editing = null;
const fileById = id => ui().files().find(x => x.id === id) || null;
const curF = () => ui().curFile();
const whoAmI = () => (me && (me.name || me.login)) || '';
const rel = iso => {
  const s = (Date.parse(iso) - Date.now()) / 1000, a = Math.abs(s);
  const fmt = new Intl.RelativeTimeFormat(LANG === 'de' ? 'de' : 'en', { numeric:'auto' });
  if (a < 45) return LANG === 'de' ? 'gerade eben' : 'just now';
  if (a < 3600) return fmt.format(Math.round(s / 60), 'minute');
  if (a < 86400) return fmt.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return fmt.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString(LANG === 'de' ? 'de-DE' : 'en-US', { day:'numeric', month:'short', year:'numeric' });
};

/* Entwürfe im Browser: { "<id>#<tab>": { id, draft, sha, ts } }, Tabs melden sich alle 5 s (Herzschlag) */
function persistDrafts(){
  const all = read(DRAFT_KEY) || {};
  for (const k of Object.keys(all)) if (k.endsWith('#' + TAB)) delete all[k];
  for (const [id, d] of Object.entries(dirty)) all[id + '#' + TAB] = { id, draft:d.draft, sha:d.sha, ts:d.ts || Date.now(), owner:me && me.login };
  write(DRAFT_KEY, all);
}
function beat(){ const t = read(TABS_KEY) || {}; t[TAB] = Date.now(); for (const k of Object.keys(t)) if (Date.now() - t[k] > 600000) delete t[k]; write(TABS_KEY, t); }
beat(); setInterval(beat, 5000);
window.addEventListener('pagehide', () => { persistDrafts(); const t = read(TABS_KEY) || {}; delete t[TAB]; write(TABS_KEY, t); });
/* Nach dem Laden: Entwürfe aus geschlossenen Tabs übernehmen (offene Tabs speichern selbst) */
function restoreDrafts(late){
  if (!me) return;
  const all = read(DRAFT_KEY) || {}, tabs = read(TABS_KEY) || {};
  const loadedSrc = new Set(data.files.map(f => f.src));
  let n = 0;
  // Pro Datei gewinnt der neueste Entwurf aus geschlossenen Tabs desselben Kontos, ältere kommen in die Sicherheitskopie
  const newest = {};
  for (const [k, e] of Object.entries(all)) {
    const tab = k.split('#')[1];
    if (tab === TAB || (tabs[tab] && Date.now() - tabs[tab] < TAB_DEAD)) continue;
    if (e.owner && e.owner !== me.login) continue;          // Entwürfe anderer Konten bleiben unangetastet
    if (!loadedSrc.has(e.id.split('|')[0])) continue;        // Bereich gerade nicht geladen: später erneut versuchen
    delete all[k];
    if (!data.files.some(f => f.id === e.id)) { backupDraft(e.id, e.draft); continue; }   // Datei gibt es nicht mehr
    if (!newest[e.id] || newest[e.id].ts < e.ts) { if (newest[e.id]) backupDraft(e.id, newest[e.id].draft); newest[e.id] = e; }
    else backupDraft(e.id, e.draft);
  }
  for (const e of Object.values(newest)) {
    const f = data.files.find(x => x.id === e.id);
    if (f.content === e.draft) continue;
    if (dirty[e.id]) { if (dirty[e.id].draft !== e.draft) backupDraft(e.id, e.draft); continue; }   // hier wird gerade gearbeitet: nicht überschreiben
    const conflictNow = f.sha !== e.sha;
    dirty[e.id] = { base:conflictNow ? null : f.content, sha:e.sha, draft:e.draft, ts:e.ts, conflict:conflictNow, state:conflictNow ? 'conflict' : 'pending' };
    f.content = e.draft;
    n++;
    if (late && ui()) { const uf = fileById(e.id); if (uf) ui().apply({ upserts:[fileCopy(uf, e.draft)] }); }
    if (!conflictNow) schedule(e.id, 500);
  }
  write(DRAFT_KEY, all);
  persistDrafts();
  if (n) setTimeout(() => ui() && ui().toast(T('gh.restored', { n })), 400);
}
function afterDoc(f){
  if (editing && !editing.ta.isConnected) editing = null;   // Dokument wurde neu gezeichnet
  const art = document.getElementById('article');
  if (!art) return;
  const r = repoOf(f);
  status(f);
  if (r && !f.virtual) lastLine(f, art);
  if (!r || f.virtual || !canWrite(r)) { if (r && !f.virtual) art.insertAdjacentHTML('afterbegin', `<div class="gh-ro">${icon('file')}${E(T('gh.readonly'))}</div>`); return; }
  art.classList.add('gh-editable');
  if (ui().isRaw()) {
    const pre = art.querySelector('pre.raw');
    if (pre) {
      const ta = document.createElement('textarea');
      ta.className = 'gh-rawedit'; ta.value = f.content || ''; ta.spellcheck = false;
      pre.replaceWith(ta); grow(ta);
      const done = () => { if (editing && editing.ta === ta) { editing = null; flushRemote(f.id); } };
      ta.addEventListener('focus', () => { editing = { id:f.id, ta, raw:true, done }; });
      ta.addEventListener('input', () => { grow(ta); setDraft(f.id, ta.value); });
      ta.addEventListener('blur', done);
    }
    return;
  }
  art.title = T('gh.editHint');
  art.addEventListener('click', e => {
    if (editing && !editing.ta.isConnected) editing = null;
    if (editing || e.target.closest('a,button,input,textarea,.mdlink,img,.gh-last')) return;
    const block = e.target.closest('[data-l]');
    if (block && block.parentElement === art) editBlock(f.id, block);
  });
  const add = document.createElement('button');
  add.className = 'btn gh-add'; add.innerHTML = icon('plus') + E(T('gh.addBlock'));
  add.addEventListener('click', () => {
    const cur = fileById(f.id);
    const lines = (cur.content || '').replace(/\s+$/, '').split('\n');
    const at = lines.length + 1;
    setDraft(f.id, lines.join('\n') + '\n\n' + T('gh.newText') + '\n', true);
    const blk = document.querySelector(`#article [data-l^="${at}-"]`);
    if (blk) editBlock(f.id, blk, true);
  });
  art.insertBefore(add, art.querySelector('.backlinks') || art.querySelector('.docmeta'));
}
/* „Zuletzt geändert von … · vor 5 Min. · Versionen“ unter dem Titel */
function lastLine(f, art){
  const d = dateOf(f.sha) || {};
  const at = d.at || (f.ts ? new Date(f.ts * 1000).toISOString() : null);
  const html = `<div class="gh-last">${icon('clock')}<span>${E(d.who ? T('gh.lastBy', { who:d.who, when:rel(at) }) : T('gh.lastAt', { when:rel(at) }))}</span><button class="gh-link" data-gh="versions">${E(T('gh.versions'))}</button></div>`;
  const h1 = art.querySelector('h1');
  if (h1) h1.insertAdjacentHTML('afterend', html); else art.insertAdjacentHTML('afterbegin', html);
}
function grow(ta){ ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
function editBlock(id, block, selectAll){
  const f = fileById(id);
  const [a, b] = block.dataset.l.split('-').map(Number);
  const baseLines = (f.content || '').replace(/\r/g, '').split('\n');
  const compose = val => { const c = baseLines.slice(), v = val.replace(/\s+$/, ''); c.splice(a, b - a + 1, ...(v ? v.split('\n') : [])); return c.join('\n').replace(/\n{3,}/g, '\n\n'); };
  const ta = document.createElement('textarea');
  ta.className = 'gh-blockedit'; ta.value = baseLines.slice(a, b + 1).join('\n'); ta.spellcheck = true;
  ta.dataset.kind = block.tagName.toLowerCase();
  block.replaceWith(ta);
  const done = () => {
    if (!editing || editing.ta !== ta) return;
    editing = null;
    setDraft(id, compose(ta.value), true);
    flushRemote(id);
  };
  editing = { id, ta, done };
  grow(ta); ta.focus();
  if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('input', () => { grow(ta); setDraft(id, compose(ta.value)); });
  ta.addEventListener('blur', done);
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); done(); }
  });
}
/* Neuer Text für eine Datei: Entwurf merken, sichern, Speichern planen. rerender = Dokument neu zeichnen */
function setDraft(id, text, rerender){
  const f = fileById(id);
  if (!f) return;
  const d = dirty[id] || { base:f.content, sha:f.sha };
  if (text === d.base && !d.saving) { delete dirty[id]; clearTimeout(d.timer); }
  else { d.draft = text; d.ts = Date.now(); dirty[id] = d; if (!d.conflict) schedule(id); }
  persistDrafts();
  if (rerender) ui().apply({ upserts:[fileCopy(f, text)] });
  else { f.content = text; status(f); }
}
const fileCopy = (f, content, extra = {}) => ({ id:f.id, src:f.src, path:f.path, abs:f.abs, mod:f.mod, ts:f.ts, size:f.size, sha:f.sha, cloud:false, content, ...extra });
function schedule(id, delay = SAVE_DELAY){
  const d = dirty[id];
  if (!d) return;
  clearTimeout(d.timer);
  d.timer = setTimeout(() => doSave(id), delay);
  if (!d.saving && !d.retry) d.state = 'pending';
  const f = curF(); if (f && f.id === id) status(f);
}
/* Speichern. opt.message (z. B. Wiederherstellen), opt.newVersion (keine Sitzung fortsetzen), opt.force = SHA, gegen die überschrieben werden darf */
async function doSave(id, opt = {}){
  const d = dirty[id];
  if (!d || d.conflict && !opt.force && !opt.create) return;
  if (d.saving) { d.again = true; return; }
  const f = fileById(id), r = f && repoOf(f);
  if (!f || !r) return;
  clearTimeout(d.timer);
  d.saving = true; d.state = 'saving'; status(f);
  const text = d.draft;
  try {
    const res = await commitFile(f, r, text, typeof opt.force === 'string' ? opt.force : d.sha, opt);
    d.sha = res.blob; d.base = text; d.retry = 0; d.conflict = false;
    blobs[res.blob] = text; dates[res.blob] = { at:new Date().toISOString(), who:whoAmI() };
    write(BLOB_KEY, blobs); write(DATE_KEY, dates);
    const known = heads[r.full_name];
    if (!known || known.sha === res.prev) heads[r.full_name] = { sha:res.commit, etag:null };   // sonst holt der nächste Abgleich fremde Änderungen nach
    const cur = fileById(id);
    if (cur) { cur.sha = res.blob; cur.mod = today(); cur.ts = Date.now() / 1000; }
    const df = data.files.find(x => x.id === id);   // eigene Liste für den Abgleich mitführen
    if (df) { df.sha = res.blob; df.content = text; df.mod = today(); df.ts = Date.now() / 1000; }
    if (d.draft === text && !d.again) { delete dirty[id]; d.state = 'saved'; savedAt[id] = Date.now(); }
    else schedule(id, 400);
    persistDrafts();
    if (cur && !(editing && editing.id === id)) ui().apply({ upserts:[fileCopy(cur, cur.content)] });
  } catch(e) {
    if (e.status === 409 || (e.status === 422 && /sha|match/i.test(e.message))) { d.conflict = true; d.state = 'conflict'; await conflict(id); }
    else {
      d.retry = (d.retry || 0) + 1; d.state = e.status === 401 ? 'auth' : 'retry';
      const wait = [3, 6, 15, 30, 60][Math.min(d.retry - 1, 4)] * 1000;
      clearTimeout(d.timer); d.timer = setTimeout(() => doSave(id), wait);
    }
  } finally {
    d.saving = false;
    if (d.again && dirty[id] && !d.conflict) { d.again = false; schedule(id, 300); }
    const c = curF(); if (c && c.id === id) status(c);
  }
}
const savedAt = {};
/* Eine Version anlegen oder die eigene Sitzungs-Version ersetzen. Gibt { blob, commit } zurück. */
async function commitFile(f, r, text, baseSha, opt){
  const path = f.path.join('/'), branch = r.default_branch, s = sessions[f.id];
  const message = opt.message || T('gh.commitMsg', { who:whoAmI(), name:f.name });
  const h = heads[r.full_name];
  if (s && !opt.newVersion && !opt.force && !opt.create && !opt.keepalive && Date.now() - s.last < SESSION_IDLE && r.node_id && (!h || h.sha === s.commit)) {
    try {
      // Kein extra Abruf des Branch-Stands nötig: updateRefs ersetzt nur, wenn der Branch noch auf unserer Sitzungs-Version steht (beforeOid)
      if (!s.parentTree) s.parentTree = (await gh(`/repos/${r.full_name}/git/commits/${s.parent}`)).tree.sha;
      // Text direkt im Verzeichnis-Eintrag mitschicken (spart eine Anfrage), die Blob-SHA berechnen wir selbst
      const tree = await gh(`/repos/${r.full_name}/git/trees`, { method:'POST', body:{ base_tree:s.parentTree, tree:[{ path, mode:'100644', type:'blob', content:text }] } });
      const blob = { sha:await blobSha(text) };
      const commit = await gh(`/repos/${r.full_name}/git/commits`, { method:'POST', body:{ message, tree:tree.sha, parents:[s.parent] } });
      await gql(`mutation($id:ID!,$u:[RefUpdate!]!){updateRefs(input:{repositoryId:$id,refUpdates:$u}){clientMutationId}}`,
        { id:r.node_id, u:[{ name:'refs/heads/' + branch, beforeOid:s.commit, afterOid:commit.sha, force:true }] });
      const prev = s.commit;
      s.commit = commit.sha; s.last = Date.now();
      return { blob:blob.sha, commit:commit.sha, prev };
    } catch(e) { if (e.status === 401 || e.status === 0) throw e; /* sonst: normale neue Version */ }
  }
  const body = { message, content:toB64(text), branch };
  if (!opt.create) {
    // GitHub legt eine inzwischen gelöschte Datei beim Speichern stillschweigend neu an. Deshalb vorher prüfen, ob es sie noch gibt
    // und ob sie noch unsere bekannte Fassung ist (spart bei einem Konflikt auch das Speichern selbst).
    let now = null;
    try { now = await gh(`/repos/${r.full_name}/contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`); }
    catch(e) { if (e.status === 404) throw new GhError(409, 'deleted'); throw e; }
    if (now && now.sha !== baseSha) throw new GhError(409, 'changed');
    body.sha = baseSha;
  }
  const res = await gh(`/repos/${r.full_name}/contents/${encPath(path)}`, { method:'PUT', keepalive:!!opt.keepalive, body });
  const parent = res.commit.parents && res.commit.parents[0];
  sessions[f.id] = opt.newVersion ? null : { commit:res.commit.sha, parent:parent && parent.sha, last:Date.now() };
  if (!sessions[f.id] || !sessions[f.id].parent) delete sessions[f.id];
  return { blob:res.content.sha, commit:res.commit.sha, prev:parent && parent.sha };
}
function saveNow(){ if (editing && !editing.raw) editing.done(); for (const id of Object.keys(dirty)) if (!dirty[id].conflict) doSave(id); }

/* Ruhige Statusanzeige unten rechts statt Speichern-Leiste */
function status(f){
  let el = document.getElementById('ghStatus');
  const content = document.getElementById('content');
  if (!f || !content) { if (el) el.remove(); return; }
  const d = dirty[f.id];
  const st = d ? d.state || 'pending' : (savedAt[f.id] && Date.now() - savedAt[f.id] < 4000 ? 'saved' : null);
  if (!st) { if (el) el.remove(); return; }
  if (!el || el.parentElement !== content) { if (el) el.remove(); el = document.createElement('div'); el.id = 'ghStatus'; content.appendChild(el); }
  el.className = 'gh-status ' + st;
  const btn = st === 'conflict' ? `<button class="gh-link" data-gh="conflict">${E(T('gh.show'))}</button>` : st === 'auth' ? `<button class="gh-link" data-gh="signin">${E(T('gh.signinAgain'))}</button>` : st === 'retry' ? `<button class="gh-link" data-gh="savenow">${E(T('gh.tryNow'))}</button>` : '';
  el.innerHTML = `<span class="dot"></span><span>${E(T('gh.st.' + st))}</span>${btn}`;
  if (st === 'saved') { clearTimeout(el._t); el._t = setTimeout(() => { const c = curF(); if (!c || !dirty[c.id]) el.remove(); }, 4000); }
}

/* Jemand anderes hat gespeichert: nichts überschreiben, verständlich warnen. Der eigene Text bleibt im Entwurf und auf Wunsch in der Zwischenablage. */
async function conflict(id){
  const f = fileById(id), r = f && repoOf(f), d = dirty[id];
  if (!f || !r || !d) return;
  const path = f.path.join('/');
  let latest = null, who = T('gh.someone'), when = '';
  try { latest = await gh(`/repos/${r.full_name}/contents/${encPath(path)}?ref=${encodeURIComponent(r.default_branch)}`); } catch(e) { if (e.status !== 404) return; }
  try {
    const c = (await gh(`/repos/${r.full_name}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(r.default_branch)}&per_page=1`))[0];
    if (c) { who = c.commit.author.name || (c.author && c.author.login) || who; when = rel(c.commit.author.date); }
  } catch(e) {}
  const c = curF();
  if (!c || c.id !== id) { if (c) status(c); return; }   // Hinweis erscheint, sobald die Datei offen ist
  if (document.querySelector('.gh-ov.conflict')) return;
  if (editing && editing.id === id && !editing.raw) editing.done();   // Absatz schließen, Text ist im Entwurf
  const ov = dialog(`<h3>${icon('file')}${E(T('gh.conflictTitle'))}</h3><p>${E(T('gh.conflictText', { who, name:f.name, when }))}</p><p class="muted">${E(T('gh.conflictSafe'))}</p>
    <div class="gh-dbtns"><button class="btn" data-d="later">${E(T('gh.later'))}</button>${latest
      ? `<button class="btn" data-d="mine">${E(T('gh.keepMine'))}</button><button class="btn primary" data-d="load">${E(T('gh.loadNew'))}</button>`
      : `<button class="btn" data-d="drop">${E(T('gh.dropMine'))}</button><button class="btn primary" data-d="recreate">${E(T('gh.recreate'))}</button>`}</div>`,
    async act => {
      const dd = dirty[id];
      if (!dd) return;
      if (act === 'load') {
        try { await navigator.clipboard.writeText(dd.draft); ui().toast(T('gh.copiedMine')); } catch(e) {}
        const text = fromB64(latest.content);
        blobs[latest.sha] = text; write(BLOB_KEY, blobs);
        clearTimeout(dd.timer); delete dirty[id]; delete sessions[id];
        backupDraft(id, dd.draft);
        persistDrafts();
        const cur = fileById(id);
        ui().apply({ upserts:[fileCopy(cur, text, { sha:latest.sha, mod:today(), ts:Date.now() / 1000 })] });
      }
      if (act === 'mine') { dd.conflict = false; delete sessions[id]; doSave(id, { force:latest.sha, newVersion:true }); }
      if (act === 'recreate') { dd.conflict = false; delete sessions[id]; doSave(id, { create:true, newVersion:true }); }
      if (act === 'drop') {
        try { await navigator.clipboard.writeText(dd.draft); ui().toast(T('gh.copiedMine')); } catch(e) {}
        backupDraft(id, dd.draft); clearTimeout(dd.timer); delete dirty[id]; delete sessions[id]; persistDrafts();
        const cur = fileById(id); if (cur) ui().apply({ removes:[cur.abs] });
      }
    });
  ov.classList.add('conflict');
}
/* Sicherheitskopie verworfener eigener Fassungen (die letzten 20), falls die Zwischenablage nicht ging */
function backupDraft(id, text){ const b = read('natively:gh:backup') || []; b.unshift({ id, text, at:Date.now() }); write('natively:gh:backup', b.slice(0, 20)); }
function dialog(html, onAct){
  const ov = document.createElement('div');
  ov.className = 'overlay gh-ov';
  ov.innerHTML = `<div class="gh-dialog" role="alertdialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) { close(); onAct && onAct(b.dataset.d); } else if (e.target === ov) close(); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  const first = ov.querySelector('.btn.primary') || ov.querySelector('.btn'); if (first) first.focus();
  return ov;
}

/* ---------- Abgleich: Änderungen von Kollegen, Claude oder github.com von selbst erkennen ----------
   Alle 45 s und sofort bei Rückkehr in den Tab: pro Bereich nur die Branch-SHA (mit ETag, 304 kostet nichts).
   Hat sie sich geändert, werden nur die geänderten Dateien geladen. */
let pollTimer = null, polling = false, restoreTimer = null;
const remoteWaiting = {};   // Datei-ID → neue Fassung, die ankam, während die Datei bearbeitet wurde
function startPolling(){ clearInterval(pollTimer); pollTimer = setInterval(poll, POLL_EVERY); }
async function poll(){
  if (!auth || polling || document.hidden || authExpired) return;
  polling = true;
  try {
    // Alle Bereiche gleichzeitig prüfen (304 = unverändert, kostet kein Kontingent), dann nur geänderte nachladen
    const changed = [];
    await pool(repos, 6, async r => {
      let h;
      try { h = await headOf(r, true); } catch(e) { return; }
      const known = heads[r.full_name] || {};
      if (h.same || h.sha === known.sha) { if (!h.same) heads[r.full_name] = { sha:h.sha, etag:h.etag }; return; }
      changed.push([r, h]);
    });
    let any = false;
    await pool(changed, 3, async ([r, h]) => {
      try { await syncRepo(r, h.sha); heads[r.full_name] = { sha:h.sha, etag:h.etag }; any = true; }   // erst nach Erfolg merken, sonst nächstes Mal erneut
      catch(e) { console.warn('sync', r.full_name, e); }
    });
    if (any) { refreshRecent(); tlRefresh().catch(() => {}); }
  } finally { polling = false; }
}
async function syncRepo(r, headSha){
  const items = await loadTree(r, headSha);
  const src = srcId(r);
  const mine = data.files.filter(f => f.src === src);
  const byPath = new Map(mine.map(f => [f.path.join('/'), f]));
  const changed = items.filter(x => { const f = byPath.get(x.path); return !f || f.sha !== x.sha; });
  const gone = mine.filter(f => !items.some(x => x.path === f.path.join('/')) && !dirty[f.id]);
  if (!changed.length && !gone.length) return;
  await fetchBlobs(r, changed);
  await loadDates(r, changed);
  write(BLOB_KEY, blobs); write(DATE_KEY, dates);
  const ups = [], notes = [];
  const cur = curF();
  for (const x of changed) {
    const nf = makeFile(r, x), d = dirty[nf.id];
    if (d) {
      if (d.saving || d.sha === x.sha) continue;
      if (blobs[x.sha] === d.draft) { clearTimeout(d.timer); delete dirty[nf.id]; persistDrafts(); nf.content = d.draft; }
      else { d.conflict = true; d.state = 'conflict'; clearTimeout(d.timer); if (cur && cur.id === nf.id) conflict(nf.id); continue; }
    }
    if (editing && editing.id === nf.id) { remoteWaiting[nf.id] = nf; continue; }
    ups.push(nf);
    if (cur && cur.id === nf.id) notes.push(nf);
  }
  data.files = data.files.filter(f => !gone.includes(f) && !ups.some(u => u.id === f.id)).concat(ups);
  if (ups.length || gone.length) ui().apply({ upserts:ups, removes:gone.map(f => f.abs) });
  for (const nf of notes) { const d = dateOf(nf.sha) || {}; ui().toast(T('gh.updated', { name:nf.name, who:d.who || T('gh.someone') })); }
  refreshOverview();
}
/* Neue Fassung, die während des Bearbeitens kam: nach dem Bearbeiten prüfen */
function flushRemote(id){
  const nf = remoteWaiting[id];
  if (!nf) return;
  delete remoteWaiting[id];
  const d = dirty[id];
  if (d && d.sha !== nf.sha) { d.conflict = true; d.state = 'conflict'; clearTimeout(d.timer); conflict(id); return; }
  if (!d) { ui().apply({ upserts:[nf] }); ui().toast(T('gh.updated', { name:nf.name, who:(dateOf(nf.sha) || {}).who || T('gh.someone') })); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); retryAll(); } });
window.addEventListener('focus', () => { poll(); retryAll(); });
window.addEventListener('online', retryAll);
let scanRetry = null;
function retryScan(){
  if (scanRetry) return;
  const go = async () => { scanRetry = null; try { await reload(); } catch(e) { if (e.status === 0) retryScan(); } };
  scanRetry = setTimeout(go, 5000);
  window.addEventListener('online', () => { if (scanRetry) { clearTimeout(scanRetry); go(); } }, { once:true });
}
function retryAll(){ for (const [id, d] of Object.entries(dirty)) if (d.retry && !d.saving && !d.conflict) doSave(id); }

/* ---------- Versionen einer Datei: wer, wann, was. Alte Fassung ansehen, Unterschiede, wiederherstellen ---------- */
async function openVersions(id, sha){
  const f = fileById(id || (curF() && curF().id)), r = f && repoOf(f);
  if (!f || !r) return;
  document.querySelectorAll('.menu').forEach(m => m.remove());
  const path = f.path.join('/');
  const ov = document.createElement('div');
  ov.className = 'overlay gh-ov'; ov.id = 'ghVersions';
  ov.innerHTML = `<div class="gh-dialog gh-admin gh-versions" role="dialog" aria-modal="true"><div class="gh-ahead"><b>${E(T('gh.versionsOf', { name:f.name }))}</b><button class="iconbtn" data-x aria-label="${E(T('close'))}">${icon('x')}</button></div><div class="gh-abody"><nav class="gh-areas"><p class="muted">${E(T('gh.loading'))}</p></nav><section class="gh-apane"></section></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
  ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); ov.remove(); } });
  let list = [];
  try { list = await gh(`/repos/${r.full_name}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(r.default_branch)}&per_page=30`); }
  catch(e) { ov.querySelector('.gh-areas').innerHTML = `<p class="muted">${E(T('gh.failed', { msg:e.message }))}</p>`; return; }
  const nav = ov.querySelector('.gh-areas'), pane = ov.querySelector('.gh-apane');
  nav.innerHTML = list.map((c, i) => `<button class="nitem gh-ver${i === 0 ? ' on' : ''}" data-v="${i}"><span class="lbl"><b>${E(c.commit.author.name || (c.author && c.author.login) || '')}</b><small>${E(rel(c.commit.author.date))}${i === 0 ? ' · ' + E(T('gh.current')) : ''}</small><small>${E((c.commit.message || '').split('\n')[0])}</small></span></button>`).join('') || `<p class="muted">–</p>`;
  const show = async i => {
    nav.querySelectorAll('.gh-ver').forEach(b => b.classList.toggle('on', +b.dataset.v === i));
    const c = list[i];
    pane.innerHTML = `<p class="muted">${E(T('gh.loading'))}</p>`;
    let old = '';
    try { old = fromB64((await gh(`/repos/${r.full_name}/contents/${encPath(path)}?ref=${c.sha}`)).content || ''); }
    catch(e) { pane.innerHTML = `<p class="gh-note">${E(i === list.length - 1 && e.status === 404 ? T('gh.created0') : T('gh.failed', { msg:e.message }))}</p>`; return; }
    const now = fileById(f.id).content || '';
    const same = old === now;
    pane.innerHTML = `<h3>${E(new Date(c.commit.author.date).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-US', { dateStyle:'medium', timeStyle:'short' }))} <small>${E(c.commit.author.name || '')}</small></h3>
      <p class="muted">${E((c.commit.message || '').split('\n')[0])}</p>
      <div class="gh-dbtns" style="justify-content:flex-start">${same ? `<span class="muted">${E(T('gh.sameAsNow'))}</span>` : canWrite(r) ? `<button class="btn primary" data-restore="${i}">${E(T('gh.restore'))}</button>` : ''}<button class="btn" data-url="${E(c.html_url)}">${icon('out')}GitHub</button></div>
      <h4>${E(T('gh.diffTitle'))}</h4>${same ? '' : diffHtml(old, now)}`;
    pane.querySelector('[data-restore]') && pane.querySelector('[data-restore]').addEventListener('click', () => {
      if (!confirm(T('gh.restoreAsk'))) return;
      ov.remove();
      const when = new Date(c.commit.author.date).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-US', { dateStyle:'medium', timeStyle:'short' });
      setDraft(f.id, old, true);
      delete sessions[f.id];
      doSave(f.id, { newVersion:true, message:T('gh.restoreMsg', { who:whoAmI(), name:f.name, when }) });
    });
  };
  nav.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) show(+b.dataset.v); });
  ov.querySelector('[data-x]').addEventListener('click', () => ov.remove());
  let want = sha ? list.findIndex(c => c.sha === sha) : -1;
  if (sha && want < 0) {   // ältere Version außerhalb der ersten 30: einzeln holen und oben anzeigen
    try { const c = await gh(`/repos/${r.full_name}/commits/${sha}`); list.unshift(c); want = 0; nav.insertAdjacentHTML('afterbegin', `<button class="nitem gh-ver" data-v="0"><span class="lbl"><b>${E(c.commit.author.name || '')}</b><small>${E(rel(c.commit.author.date))}</small><small>${E((c.commit.message || '').split('\n')[0])}</small></span></button>`); nav.querySelectorAll('.gh-ver').forEach((b, k) => b.dataset.v = k); } catch(e) {}
  }
  if (list.length) show(want >= 0 ? want : list.length > 1 ? 1 : 0);
}
/* Einfache Zeilen-Unterschiede: rot = fällt weg (gegenüber jetzt), grün = kam dazu. Unveränderte Abschnitte werden gekürzt. */
function diffHtml(a, b){
  const A = a.replace(/\r/g, '').split('\n'), B = b.replace(/\r/g, '').split('\n');
  if (A.length * B.length > 4e6) return `<p class="muted">${E(T('gh.tooLong'))}</p>`;
  const n = A.length, m = B.length, L = Array.from({ length:n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { ops.push(['=', A[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', A[i++]]); else ops.push(['+', B[j++]]); }
  while (i < n) ops.push(['-', A[i++]]); while (j < m) ops.push(['+', B[j++]]);
  const out = [];
  ops.forEach((o, k) => {
    if (o[0] !== '=') { out.push(`<div class="gh-dl ${o[0] === '-' ? 'del' : 'add'}"><span>${o[0] === '-' ? '−' : '+'}</span>${E(o[1]) || '&nbsp;'}</div>`); return; }
    const near = ops.slice(Math.max(0, k - 2), k + 3).some(x => x[0] !== '=');
    if (near) out.push(`<div class="gh-dl"><span></span>${E(o[1]) || '&nbsp;'}</div>`);
    else if (out[out.length - 1] !== '<div class="gh-dl gap">…</div>') out.push('<div class="gh-dl gap">…</div>');
  });
  return `<div class="gh-diff"><p class="muted">${E(T('gh.diffLegend'))}</p>${out.join('')}</div>`;
}

/* ---------- Verlauf (Timeline): wer hat wann was geändert ----------
   Quelle sind nur die GitHub-Versionen (Commits), nichts wird extra gespeichert. Jede Person sieht nur Bereiche, für die sie Rechte hat.
   Ansichten: "verlauf" (ganzer Workspace), "verlauf:area:<Bereich>", "verlauf:file:<Datei>". Darstellung als Zeitleiste oder Tabelle. */
const TL_PAGE = 30, CD_KEY = 'natively:gh:cdetails';
const tlStates = {};                         // Ansicht → Zustand (geladene Versionen, Seiten pro Bereich)
const cdetails = read(CD_KEY) || {};          // Commit-SHA → { files:[{ filename, status, additions, deletions, patch }] } (unveränderlich, darf gemerkt werden)
const tlPrefs = Object.assign({ layout:'timeline', pageSize:50 }, read('natively:gh:tl') || {});
function saveDetails(){
  const keys = Object.keys(cdetails);
  if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete cdetails[k]);
  write(CD_KEY, cdetails);
}
const isClaude = c => /co-authored-by:\s*claude/i.test(c.commit.message || '') || /claude/i.test((c.author && c.author.login) || '') || /^claude/i.test(c.commit.author.name || '');
const personOf = c => isClaude(c) ? 'Claude' : (c.commit.author.name || (c.author && c.author.login) || T('gh.someone'));
function parseView(view){
  const [, kind, ...rest] = view.split(':');
  return { kind:kind || 'all', key:rest.join(':') };
}
function viewName(view){
  const v = parseView(view), base = T('gh.timeline');
  if (v.kind === 'area') { const r = repoOf(v.key); return base + ' · ' + (r ? r.name : v.key); }
  if (v.kind === 'file') { const f = fileById(v.key) || data.files.find(x => x.id === v.key); return base + ' · ' + (f ? (f.name || f.path[f.path.length - 1]) : ''); }
  return base;
}
function tlState(view){
  if (tlStates[view]) return tlStates[view];
  const v = parseView(view);
  let list = v.kind === 'area' ? repos.filter(r => srcId(r) === v.key) : v.kind === 'file' ? repos.filter(r => srcId(r) === v.key.split('|')[0]) : repos.slice();
  const st = tlStates[view] = { view, v, repos:list, cur:{}, commits:[], seen:new Set(), loading:false, error:{}, person:'', area:'', text:'', range:'all', page:0, open:null, fresh:new Set() };
  list.forEach(r => st.cur[r.full_name] = { page:0, done:false, oldest:Infinity });
  return st;
}
function sinceOf(range){
  const d = { today:0, week:7, month:30 }[range];
  if (d == null) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - d);
  return t.toISOString();
}
/* Älteste geladene Zeit, bis zu der die Liste lückenlos ist (bei mehreren Bereichen) */
function frontier(st){
  let f = -Infinity;
  for (const r of st.repos) { const c = st.cur[r.full_name]; if (!c.done) f = Math.max(f, c.oldest); }
  return f;
}
async function fetchPage(st, r){
  const c = st.cur[r.full_name];
  const q = new URLSearchParams({ sha:r.default_branch, per_page:String(TL_PAGE), page:String(c.page + 1) });
  if (st.v.kind === 'file') q.set('path', st.v.key.split('|').slice(1).join('|'));
  const since = sinceOf(st.range); if (since) q.set('since', since);
  try {
    const list = await gh(`/repos/${r.full_name}/commits?${q}`);
    c.page++;
    if (list.length < TL_PAGE) c.done = true;
    for (const x of list) if (!st.seen.has(x.sha)) { st.seen.add(x.sha); st.commits.push({ r, c:x, t:Date.parse(x.commit.author.date) }); }
    if (list.length) c.oldest = Date.parse(list[list.length - 1].commit.author.date);
  } catch(e) {
    c.done = true;
    st.error[r.full_name] = e.status === 409 ? 'empty' : e.status === 404 || e.status === 403 ? 'rights' : e.message;   // 409 = Bereich ohne Versionen
    if (e.status === 0 || e.status === 401) throw e;
  }
}
async function fetchDetails(items){
  const need = items.filter(x => !cdetails[x.c.sha]);
  await pool(need, 8, async x => {
    try {
      const d = await gh(`/repos/${x.r.full_name}/commits/${x.c.sha}`);
      cdetails[x.c.sha] = { files:(d.files || []).map(f => ({ filename:f.filename, status:f.status, sha:f.sha, additions:f.additions, deletions:f.deletions, patch:(f.patch || '').slice(0, 3000) })) };
    } catch(e) { if (e.status === 0 || e.status === 401) throw e; }
  });
  if (need.length) saveDetails();
}
/* Mehr laden: Seiten nachholen, bis mindestens `want` neue Einträge sichtbar sind oder alles geladen ist */
async function tlLoad(view, want = TL_PAGE){
  const st = tlState(view);
  if (st.loading) return;
  st.loading = true; tlRender(view);
  try {
    const before = tlRows(st).length;
    for (let round = 0; round < 8; round++) {
      const f = frontier(st);
      const todo = st.repos.filter(r => !st.cur[r.full_name].done && (st.cur[r.full_name].page === 0 || st.cur[r.full_name].oldest >= f));
      if (!todo.length) break;
      await pool(todo, 4, r => fetchPage(st, r));
      st.commits.sort((a, b) => b.t - a.t);
      if (st.v.kind !== 'file') await fetchDetails(visibleCommits(st));
      if (tlRows(st).length - before >= want) break;
    }
  } catch(e) { ui().toast(T('gh.failed', { msg:e.message })); }
  finally { st.loading = false; tlRender(view); }
}
const visibleCommits = st => { const f = frontier(st); return st.commits.filter(x => x.t >= f); };
/* Einträge: eine Zeile pro Version und MD-Datei (in der Datei-Ansicht genau eine Zeile pro Version) */
function tlRows(st){
  const rows = [];
  // Aktuelle Fassung: Prüfsumme der Datei in dieser Version = Prüfsumme der Datei jetzt
  const mark = (row, first) => { const f = row.path && fileById(srcId(row.x.r) + '|' + row.path); row.current = !!f && (row.file && row.file.sha ? row.file.sha === f.sha : first); return row; };
  for (const x of visibleCommits(st)) {
    if (st.v.kind === 'file') {
      const path = st.v.key.split('|').slice(1).join('|'), d = cdetails[x.c.sha], f = d && d.files.find(y => y.filename === path);
      rows.push(mark({ x, path, status:f ? f.status : 'modified', file:f }, !rows.length && st.range === 'all'));
      continue;
    }
    const d = cdetails[x.c.sha];
    if (!d) { rows.push({ x, path:null, status:'modified', file:null }); continue; }
    for (const f of d.files) if (MD.test(f.filename)) rows.push(mark({ x, path:f.filename, status:f.status, file:f }, false));
  }
  return rows;
}
function filtered(st){
  const text = st.text.trim().toLowerCase();
  return tlRows(st).filter(row => (!st.person || personOf(row.x.c) === st.person) && (!st.area || row.x.r.full_name === st.area)
    && (!text || (row.path || '').toLowerCase().includes(text) || (row.x.c.commit.message || '').toLowerCase().includes(text) || personOf(row.x.c).toLowerCase().includes(text)));
}
/* Beschreibung nur zeigen, wenn sie mehr sagt als „X hat Y bearbeitet (natively)“ */
const extraMsg = c => { const m = (c.commit.message || '').split('\n')[0]; return /\(natively\)$/.test(m) && !/zurückgesetzt|restored/.test(m) ? '' : m; };
const dayLabel = t => {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return T('gh.today');
  if (diff === 1) return T('gh.yesterday');
  return d.toLocaleDateString(LANG === 'de' ? 'de-DE' : 'en-US', { weekday:'long', day:'numeric', month:'long', year:d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
const fullTime = t => new Date(t).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-US', { dateStyle:'full', timeStyle:'short' });
function titleOf(row){
  if (!row.path) return (row.x.c.commit.message || '').split('\n')[0];
  const id = srcId(row.x.r) + '|' + row.path, f = fileById(id);
  return f && f.title ? f.title : row.path.split('/').pop();
}
function avatar(c){
  if (isClaude(c)) return `<span class="tl-ava claude" aria-hidden="true">C</span>`;
  const url = c.author && c.author.avatar_url;
  const n = personOf(c);
  return url ? `<img class="tl-ava" src="${E(url)}${url.includes('?') ? '&' : '?'}s=48" alt="">` : `<span class="tl-ava" aria-hidden="true">${E(n[0] || '?').toUpperCase()}</span>`;
}
function verb(row){ return T(row.status === 'added' ? 'gh.tl.added' : row.status === 'removed' ? 'gh.tl.removed' : 'gh.tl.changed', { who:'', what:'' }); }
function rowLine(row){
  const c = row.x.c, who = personOf(c), on = isClaude(c) && c.commit.author.name ? ` <small>${E(T('gh.tl.for', { who:c.commit.author.name }))}</small>` : '';
  if (!row.path) return `<b>${E(who)}</b>${on} · ${E(titleOf(row))}`;
  return `<b>${E(who)}</b>${on} ${E(T(row.status === 'added' ? 'gh.tl.added' : row.status === 'removed' ? 'gh.tl.removed' : 'gh.tl.changed', { what:'\u0001' })).replace('\u0001', `<em>${E(titleOf(row))}</em>`)}`;
}
function patchLines(file){
  if (!file || !file.patch) return '';
  const lines = file.patch.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const shown = lines.slice(0, 12).map(l => `<div class="gh-dl ${l[0] === '-' ? 'del' : 'add'}"><span>${l[0] === '-' ? '−' : '+'}</span>${E(l.slice(1)) || '&nbsp;'}</div>`).join('');
  return `<div class="gh-diff tl-diff">${shown || `<p class="muted">${E(T('gh.tl.noLines'))}</p>`}${lines.length > 12 ? `<div class="gh-dl gap">${E(T('gh.tl.more', { n:lines.length - 12 }))}</div>` : ''}</div>`;
}
function detailHtml(row, i){
  const c = row.x.c, r = row.x.r, id = row.path ? srcId(r) + '|' + row.path : null;
  const exists = id && fileById(id), removed = row.status === 'removed';
  const msg = (c.commit.message || '').replace(/\n\nCo-Authored-By:.*$/is, '');
  const loading = st => '';
  return `<div class="tl-detail" id="tld-${i}">
    <p class="tl-msg">${E(msg)}</p>
    ${row.file ? patchLines(row.file) : `<p class="muted">${E(T('gh.loading'))}</p>`}
    <div class="gh-dbtns" style="justify-content:flex-start">
      ${id && !removed ? `<button class="btn" data-tl-open="${i}">${icon('file')}${E(T('gh.tl.openVersion'))}</button>` : ''}
      ${id && !removed && canWrite(r) && !row.current ? `<button class="btn" data-tl-restore="${i}">${icon('refresh')}${E(T('gh.restore'))}</button>` : ''}
      ${row.current ? `<span class="tl-cur">${icon('check')}${E(T('gh.tl.isCurrent'))}</span>` : ''}
      ${exists ? `<button class="btn" data-open="${E(id)}">${E(T('gh.tl.openFile'))}</button>` : ''}
      <button class="btn" data-url="${E(c.html_url)}">${icon('out')}GitHub</button>
    </div></div>`;
}
let tlRowsShown = [];
function tlRender(view){
  const el = document.getElementById('content');
  const t = ui() && ui().curTab();
  if (!el || !t || t.view !== view) return;
  const st = tlState(view);
  const rows = filtered(st);
  tlRowsShown = rows;
  const more = st.repos.some(r => !st.cur[r.full_name].done);
  const people = [...new Set(tlRows(st).map(row => personOf(row.x.c)))].sort((a, b) => a.localeCompare(b));
  const opt = (v, label, cur) => `<option value="${E(v)}"${v === cur ? ' selected' : ''}>${E(label)}</option>`;
  const errs = Object.entries(st.error).map(([full, e]) => `<p class="gh-note">${E(e === 'rights' ? T('gh.tl.noRights', { area:full.split('/')[1] }) : e === 'empty' ? T('gh.tl.emptyArea', { area:full.split('/')[1] }) : T('gh.failed', { msg:e }))}</p>`).join('');
  const bar = `<div class="tl-bar" role="search">
      <label class="filter tl-search">${icon('search')}<input id="tlText" type="text" value="${E(st.text)}" placeholder="${E(T('gh.tl.searchPh'))}" autocomplete="off" spellcheck="false"></label>
      <label class="chip sel">${icon('users')}<select id="tlPerson" aria-label="${E(T('gh.tl.person'))}">${opt('', T('gh.tl.allPeople'), st.person)}${people.map(p => opt(p, p, st.person)).join('')}</select></label>
      ${st.v.kind === 'file' ? '' : `<label class="chip sel">${icon('drive')}<select id="tlArea" aria-label="${E(T('gh.tl.area'))}">${opt('', T('gh.tl.allAreas'), st.v.kind === 'area' ? st.repos[0] && st.repos[0].full_name : st.area)}${repos.map(r => opt(r.full_name, r.name, st.v.kind === 'area' ? st.repos[0] && st.repos[0].full_name : st.area)).join('')}</select></label>`}
      <label class="chip sel">${icon('sliders')}<select id="tlRange" aria-label="${E(T('gh.tl.range'))}">${opt('all', T('gh.tl.rangeAll'), st.range)}${opt('today', T('gh.today'), st.range)}${opt('week', T('gh.tl.range7'), st.range)}${opt('month', T('gh.tl.range30'), st.range)}</select></label>
      <span class="tl-seg" role="group" aria-label="${E(T('gh.tl.layout'))}"><button class="chip" data-tl-layout="timeline" aria-pressed="${tlPrefs.layout === 'timeline'}">${icon('list')}${E(T('gh.tl.asTimeline'))}</button><button class="chip" data-tl-layout="table" aria-pressed="${tlPrefs.layout === 'table'}">${icon('code')}${E(T('gh.tl.asTable'))}</button></span>
    </div>`;
  const empty = !rows.length && !st.loading ? `<div class="tl-empty">${icon('refresh', 'big')}<p>${E(tlRows(st).length ? T('gh.tl.noMatch') : T('gh.tl.none'))}</p></div>` : '';
  let body;
  if (tlPrefs.layout === 'table') {
    // Tabelle im Stil unserer Markdown-Tabellen: nur Spalten, die man wirklich braucht, Aktionen direkt in der Zeile
    body = rows.length ? `<div class="md tl-table"><div class="tablescroll"><table><thead><tr><th>${E(T('gh.tl.colTime'))}</th><th>${E(T('gh.tl.person'))}</th><th>${E(T('gh.tl.colFile'))}</th><th>${E(T('gh.tl.colChange'))}</th><th></th></tr></thead><tbody>
      ${rows.map((row, i) => { const c = row.x.c, r = row.x.r, id = row.path && srcId(r) + '|' + row.path, live = row.path && row.status !== 'removed'; return `<tr class="${st.fresh.has(c.sha) ? 'tl-new' : ''}">
        <td class="tl-nowrap"><time datetime="${E(c.commit.author.date)}" title="${E(fullTime(row.x.t))}">${E(rel(c.commit.author.date))}</time></td>
        <td class="tl-nowrap">${avatar(c)} ${E(personOf(c))}</td>
        <td>${row.path ? (fileById(id) ? `<a href="#" data-open="${E(id)}">${E(titleOf(row))}</a>` : E(row.path.split('/').pop())) : '–'}<small class="tl-sub">${E(r.name)}${row.path ? ' · ' + E(row.path) : ''}</small></td>
        <td>${E(T(row.status === 'added' ? 'gh.tl.wasAdded' : row.status === 'removed' ? 'gh.tl.wasRemoved' : 'gh.tl.wasChanged'))}${row.file ? ` <small class="tl-pm"><span class="add">+${row.file.additions}</span> <span class="del">−${row.file.deletions}</span></small>` : ''}${extraMsg(c) ? `<small class="tl-sub">${E(extraMsg(c))}</small>` : ''}</td>
        <td class="tl-nowrap tl-acts">${live ? `<button class="btn" data-tl-open="${i}">${E(T('gh.tl.view'))}</button>${canWrite(r) && !row.current ? `<button class="btn" data-tl-restore="${i}">${E(T('gh.tl.restoreShort'))}</button>` : ''}${row.current ? `<span class="tl-cur">${E(T('gh.current'))}</span>` : ''}` : ''}</td></tr>`; }).join('')}
      </tbody></table></div></div>` : empty;
  } else {
    const groups = [];
    rows.forEach((row, i) => { const label = dayLabel(row.x.t); if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items:[] }); groups[groups.length - 1].items.push([row, i]); });
    body = rows.length ? `<div class="tl" role="list">${groups.map(g => `<section class="tl-day"><h3 class="tl-dh">${E(g.label)}</h3>${g.items.map(([row, i]) => {
      const c = row.x.c, open = st.open === i;
      return `<div class="tl-entry${st.fresh.has(c.sha) ? ' tl-new' : ''}" role="listitem"><button class="tl-item" data-tl="${i}" aria-expanded="${open}" aria-controls="tld-${i}">${avatar(c)}
        <span class="tl-main"><span class="tl-line">${rowLine(row)}</span><span class="tl-meta">${E(row.x.r.name)}${row.path ? ' · ' + E(row.path) : ''}</span></span>
        <time datetime="${E(c.commit.author.date)}" title="${E(fullTime(row.x.t))}">${E(rel(c.commit.author.date))}</time></button>${open ? detailHtml(row, i) : ''}</div>`; }).join('')}</section>`).join('')}</div>` : empty;
  }
  const foot = (more || st.loading) ? `<div class="tl-more"><span class="muted">${E(T('gh.tl.count', { n:rows.length }))}</span><button class="btn" data-tl-more ${st.loading ? 'disabled' : ''}>${st.loading ? icon('refresh', 'spinning') + E(T('gh.loading')) : E(T('gh.tl.loadMore'))}</button></div>` : '';
  const sc = el.querySelector('.scroller'), keep = sc ? sc.scrollTop : 0;
  const focusId = document.activeElement && document.activeElement.id;
  el.innerHTML = `<div class="scroller tl-scroller" id="tlScroller"><div class="tl-page${tlPrefs.layout === 'table' ? ' wide' : ''}">
    <header class="tl-head"><h1>${E(viewName(view))}</h1><p class="muted">${E(T(st.v.kind === 'file' ? 'gh.tl.leadFile' : st.v.kind === 'area' ? 'gh.tl.leadArea' : 'gh.tl.leadAll'))}</p></header>
    ${bar}${errs}${body}${foot}</div></div>`;
  const nsc = el.querySelector('.scroller'); if (nsc) nsc.scrollTop = keep;
  if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); if (f.setSelectionRange && f.value != null) f.setSelectionRange(f.value.length, f.value.length); } }
  if (st.fresh.size) { clearTimeout(st.freshTimer); st.freshTimer = setTimeout(() => st.fresh.clear(), 1500); }   // Markierung „neu“ kurz behalten
}
function renderView(view){
  const st = tlState(view);
  if (!st.commits.length && !st.loading && st.repos.some(r => !st.cur[r.full_name].done)) tlLoad(view);
  tlRender(view);
}
function resetState(view, keep){
  const old = tlStates[view];
  delete tlStates[view];
  const st = tlState(view);
  if (old && keep) Object.assign(st, { person:old.person, area:old.area, text:old.text, range:keep.range != null ? keep.range : old.range });
  return st;
}
/* Neue Versionen (vom automatischen Abgleich) oben einschieben */
async function tlRefresh(){
  const t = ui() && ui().curTab();
  if (!t || !t.view || !t.view.startsWith('verlauf')) return;
  const st = tlStates[t.view];
  if (!st || st.loading) return;
  const fresh = [];
  await pool(st.repos, 4, async r => {
    const q = new URLSearchParams({ sha:r.default_branch, per_page:'20' });
    if (st.v.kind === 'file') q.set('path', st.v.key.split('|').slice(1).join('|'));
    try { for (const x of await gh(`/repos/${r.full_name}/commits?${q}`)) if (!st.seen.has(x.sha)) { st.seen.add(x.sha); const it = { r, c:x, t:Date.parse(x.commit.author.date) }; st.commits.push(it); fresh.push(it); } } catch(e) {}
  });
  if (!fresh.length) return;
  st.commits.sort((a, b) => b.t - a.t);
  if (st.v.kind !== 'file') await fetchDetails(fresh).catch(() => {});
  fresh.forEach(x => st.fresh.add(x.c.sha));
  if (st.open != null) st.open = null;
  tlRender(t.view);
}
/* Bedienung */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-tl],[data-tl-open],[data-tl-restore],[data-tl-more],[data-tl-layout]');
  if (!b) return;
  const t = ui().curTab(); if (!t || !t.view) return;
  const st = tlState(t.view), d = b.dataset;
  if (d.tl !== undefined) {
    const i = +d.tl; st.open = st.open === i ? null : i;
    const row = tlRowsShown[i];
    if (st.open === i && row && !row.file) { await fetchDetails([row.x]).catch(() => {}); }
    tlRender(t.view);
    const again = document.querySelector(`[data-tl="${i}"]`); if (again) again.focus();
    return;
  }
  if (d.tlOpen !== undefined) { const row = tlRowsShown[+d.tlOpen]; if (row) openVersions(srcId(row.x.r) + '|' + row.path, row.x.c.sha); return; }
  if (d.tlRestore !== undefined) { const row = tlRowsShown[+d.tlRestore]; if (row) restoreTo(srcId(row.x.r) + '|' + row.path, row.x.r, row.x.c); return; }
  if (d.tlMore !== undefined) { tlLoad(t.view); return; }
  if (d.tlLayout) { tlPrefs.layout = d.tlLayout; write('natively:gh:tl', tlPrefs); tlRender(t.view); return; }
});
document.addEventListener('change', e => {
  const t = ui() && ui().curTab(); if (!t || !t.view || !t.view.startsWith('verlauf')) return;
  const st = tlState(t.view), id = e.target.id;
  if (id === 'tlPerson') { st.person = e.target.value; st.page = 0; tlRender(t.view); }
  if (id === 'tlArea') { const v = e.target.value; ui().openView(v ? 'verlauf:area:' + 'gh-' + v : 'verlauf'); }
  if (id === 'tlRange') { resetState(t.view, { range:e.target.value }); tlLoad(t.view); }
});
let tlTextTimer;
document.addEventListener('input', e => {
  if (e.target.id !== 'tlText') return;
  const t = ui().curTab(), st = tlState(t.view);
  st.text = e.target.value; st.page = 0;
  clearTimeout(tlTextTimer); tlTextTimer = setTimeout(() => tlRender(t.view), 150);
});
/* Tastatur: ↑↓ zwischen Einträgen, Enter klappt auf */
document.addEventListener('keydown', e => {
  const it = e.target.closest && e.target.closest('.tl-item');
  if (!it || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  e.preventDefault();
  const all = [...document.querySelectorAll('.tl-item')], k = all.indexOf(it) + (e.key === 'ArrowDown' ? 1 : -1);
  if (all[k]) { all[k].focus(); all[k].scrollIntoView({ block:'nearest' }); }
});
/* Eine Version als neue Version wiederherstellen (nichts wird gelöscht) */
async function restoreTo(id, r, c){
  if (!canWrite(r)) return;
  const path = id.split('|').slice(1).join('|');
  let old;
  try { old = fromB64((await gh(`/repos/${r.full_name}/contents/${encPath(path)}?ref=${c.sha}`)).content || ''); }
  catch(e) { ui().toast(T('gh.failed', { msg:e.message })); return; }
  if (!confirm(T('gh.restoreAsk'))) return;
  const when = new Date(c.commit.author.date).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-US', { dateStyle:'medium', timeStyle:'short' });
  if (!fileById(id)) { ui().toast(T('gh.tl.fileGone')); return; }
  setDraft(id, old, true);
  delete sessions[id];
  await doSave(id, { newVersion:true, message:T('gh.restoreMsg', { who:whoAmI(), name:path.split('/').pop(), when }) });
  ui().toast(T('gh.tl.restored'));
}
function navState(view){
  const b = document.getElementById('navTimeline');
  if (b) b.classList.toggle('on', !!view && view.startsWith('verlauf'));
}
/* Eintrag „Verlauf“ links in der Seitenleiste und Uhr-Symbol */
(function addNav(){
  const sprite = document.querySelector('svg symbol') && document.querySelector('svg symbol').parentElement;
  if (sprite && !document.getElementById('i-clock')) sprite.insertAdjacentHTML('beforeend', '<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol><symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><path d="M3.5 18.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M15.5 6.3a3 3 0 0 1 0 5.4M17.5 14.4c1.6.6 2.6 1.9 3 4.1"/></symbol>');
  const src = document.getElementById('navSources');
  if (src && !document.getElementById('navTimeline')) src.insertAdjacentHTML('afterend', `<button class="nitem" id="navTimeline" data-gh="timeline"><svg class="i"><use href="#i-clock"/></svg><span class="lbl" data-i18n="gh.timeline">${E(T('gh.timeline'))}</span></button>`);
})();

/* ---------- Zuletzt geändert im Team (Startseite) ---------- */
let recent = [];
async function loadRecent(){
  const all = [];
  await pool(repos, 4, async r => {
    try { (await gh(`/repos/${r.full_name}/commits?sha=${encodeURIComponent(r.default_branch)}&per_page=5`)).forEach(c => all.push({ r, c })); } catch(e) {}
  });
  all.sort((x, y) => Date.parse(y.c.commit.author.date) - Date.parse(x.c.commit.author.date));
  const out = [];
  const details = await pool(all.slice(0, 10), 5, async ({ r, c }) => { try { return { r, c, d:await gh(`/repos/${r.full_name}/commits/${c.sha}`) }; } catch(e) { return null; } });
  for (const x of details) {
    if (!x) continue;
    const md = (x.d.files || []).map(f => f.filename).filter(p => MD.test(p));
    const id = md.map(p => srcId(x.r) + '|' + p).find(fid => data.files.some(f => f.id === fid));
    if (id && !out.some(o => o.id === id)) out.push({ id, who:x.c.commit.author.name || (x.c.author && x.c.author.login) || '', at:x.c.commit.author.date, area:x.r.name, msg:(x.c.commit.message || '').split('\n')[0] });
    if (out.length >= 6) break;
  }
  recent = out;
}
let recentBusy = false;
async function refreshRecent(){
  if (recentBusy) return;
  recentBusy = true;
  try { await loadRecent(); const t = ui() && ui().curTab(); if (t && !t.file && !t.dir && !t.view && !document.querySelector('.gh-ov')) ui().render(); } catch(e) {} finally { recentBusy = false; }   // nur die Startseite neu zeichnen
}
function recentHtml(){
  if (!recent.length) return '';
  return `<div class="gh-recent"><div class="gh-rh">${E(T('gh.recentTeam'))}</div>${recent.map(x => { const f = (ui() && fileById(x.id)) || data.files.find(y => y.id === x.id); return f ? `<button class="rrow" data-open="${E(x.id)}">${icon('file')}<span class="txt"><span class="nm">${E(f.title || f.path[f.path.length - 1])}</span><span class="pth">${E(x.who)} · ${E(x.area)}</span></span><time>${E(rel(x.at))}</time></button>` : ''; }).join('')}</div>`;
}

/* ---------- Admin: Mitglieder und Rollen pro Bereich, direkt über GitHub ---------- */
/* ---------- Organisation: Mitglieder, Teams, Einladungen, Zugriffsanfragen ---------- */
const orgInfo = {};   // org → { admin, base, members, admins, invites, teams, outside, requests, error }
const orgsOf = () => [...new Set(installs.filter(i => i.type === 'Organization').map(i => i.login))];
const adminOrgs = () => orgsOf().filter(o => orgInfo[o] && orgInfo[o].admin);
async function loadOrgRoles(){
  await pool(orgsOf(), 3, async org => { const o = orgInfo[org] ||= {}; try { o.admin = (await gh(`/user/memberships/orgs/${org}`)).role === 'admin'; } catch(e) { o.admin = false; } });
}
/* Offene Einladungen in Organisationen: natively nimmt sie mit einem Klick an (oder automatisch über den Link ?join=org) */
async function loadPending(){
  try { pending = (await gh('/user/memberships/orgs?state=pending')).map(m => m.organization.login); } catch(e) { pending = []; }
  const want = new URLSearchParams(location.search).get('join');
  if (want && pending.includes(want)) setTimeout(() => join(want), 100);
}
async function join(org){
  try { await gh(`/user/memberships/orgs/${org}`, { method:'PATCH', body:{ state:'active' } }); ui().toast(T('gh.joined', { org })); history.replaceState(null, '', location.pathname); await reload(); }
  catch(e) { window.open(`https://github.com/orgs/${org}/invitation`, '_blank', 'noopener'); ui().toast(T('gh.joinOnGitHub', { org })); }
}
/* Firma einrichten: ein Klick statt Anleitung. Grundrecht aus, Team „Alle“, Bereich „wissen“ mit Startseite und Regeln für Claude */
async function setupOrg(org){
  const de = LANG === 'de', d = new Date().toLocaleDateString(de ? 'de-DE' : 'en-US');
  const steps = [];
  try { await gh(`/orgs/${org}`, { method:'PATCH', body:{ default_repository_permission:'none', members_can_create_repositories:false } }); steps.push('base'); } catch(e) { console.warn('base', e); }
  let team = null;
  try { team = await gh(`/orgs/${org}/teams`, { method:'POST', body:{ name:'Alle', privacy:'closed', description:'Alle in der Firma' } }); }
  catch(e) { try { team = (await ghAll(`/orgs/${org}/teams`)).find(t => t.name === 'Alle'); } catch(e2) {} }
  let r;
  try { r = await gh(`/orgs/${org}/repos`, { method:'POST', body:{ name:'wissen', private:true, description:'natively' } }); }
  catch(e) { r = { full_name:`${org}/wissen` }; }
  const put = (path, text, msg) => gh(`/repos/${r.full_name}/contents/${path}`, { method:'PUT', body:{ message:msg + ' (natively)', content:toB64(text) } }).catch(() => {});
  await put('README.md', de
    ? `# Wissen

Was alle in ${org} wissen müssen. Stand: ${d}.

## So geht es weiter

- In diesen Text klicken und tippen, mit ⌘S speichern. Jede Änderung wird eine Version.
- Unter **Admin** Leute einladen und in Teams stecken.
- Claude über **Claude verbinden** mit dem natively-Connector verbinden. Wie Claude hier schreibt, steht in [regeln.md](regeln.md).
`
    : `# Knowledge

What everyone at ${org} needs to know. As of ${d}.

## Next steps

- Click into this text and type, save with ⌘S. Every change becomes a version.
- Invite people and put them into teams under **Admin**.
- Connect Claude with the natively connector via **Connect Claude**. How Claude writes here is in [regeln.md](regeln.md).
`, de ? 'Bereich angelegt' : 'Area created');
  await put('regeln.md', de
    ? `# Regeln für Dateien

So legen Menschen und AIs wie Claude hier Wissen ab. Stand: ${d}.

## Dateien

- **Ein Thema pro Datei.** Erst suchen, dann anlegen: Gibt es das Thema schon, die Datei ergänzen.
- Dateinamen klein mit Bindestrichen, z. B. \`urlaub-beantragen.md\`.
- Jede Datei beginnt mit \`# Titel\` und einem Satz mit \`Stand: TT.MM.JJJJ\`.
- Tabellen für Übersichten, Listen für Schritte, höchstens drei Sätze am Stück.
- Andere Dateien als normalen Markdown-Link mit relativem Pfad verlinken, z. B. \`[Urlaub](ablaeufe/urlaub.md)\`.
- Keine Passwörter oder Zugangsdaten.

## Bereiche und Rechte

- Ein Bereich ist ein Repository dieses Workspace (GitHub-Organisation). Rechte gelten für den ganzen Bereich.
- Zugriff anfragen: in diesem Bereich ein Issue mit dem Titel \`[Zugriff] name: Bearbeiten in bereich\` anlegen. Admins genehmigen in natively.
`
    : `# Rules for files

How people and AIs like Claude store knowledge here. As of ${d}.

## Files

- **One topic per file.** Search first: if the topic exists, extend that file.
- File names lowercase with hyphens, e.g. \`request-leave.md\`.
- Every file starts with \`# Title\` and a sentence with the date.
- Tables for overviews, lists for steps, at most three sentences in a row.
- Link other files with normal relative Markdown links.
- No passwords or credentials.

## Areas and rights

- An area is a repository of this organisation. Rights apply to the whole area.
- Request access: open an issue titled \`[Zugriff] name: Edit in area\` here. Admins approve in natively.
`, de ? 'Regeln für Claude' : 'Rules for Claude');
  if (team) await gh(`/orgs/${org}/teams/${team.slug}/repos/${r.full_name}`, { method:'PUT', body:{ permission:'pull' } }).catch(() => {});
  ui().toast(T('gh.setupDone', { org }) + (steps.includes('base') ? '' : ' ' + T('gh.setupBaseManual')));
  await reload();
  ui().openFile(`gh-${r.full_name}|README.md`, { pin:true });
}
/* Stellen in Claude. Zieht Claude die Seiten um, hier anpassen (Stand 13.11.2026). Die Hilfe-Seite bleibt als Rückfall. */
const CLAUDE_CONNECT = 'https://claude.ai/customize/connectors';
const CLAUDE_ADMIN = 'https://claude.ai/admin-settings/connectors';
const CLAUDE_HELP = 'https://support.claude.com/en/articles/11175166';
/* Claude verbinden: Schritt für Schritt, Adresse zum Kopieren, Knöpfe direkt an die richtige Stelle */
function connectClaude(){
  const url = location.origin + '/api/mcp';
  const ov = dialog(`<h3>${icon('link')}${E(T('gh.claude'))}</h3><p>${E(T('gh.cl.text'))}</p>
    <ol class="gh-steps">
      <li>${T('gh.cl.s1')}<div class="gh-copy"><input readonly value="${E(url)}" spellcheck="false"><button class="btn" data-cl="copy">${icon('copy')}${E(T('gh.cl.copy'))}</button></div></li>
      <li>${T('gh.cl.s2')}</li>
      <li>${T('gh.cl.s3')}</li>
      <li>${T('gh.cl.s4')}</li>
    </ol>
    <p class="gh-note">${E(T('gh.cl.team'))} <a href="${CLAUDE_ADMIN}" target="_blank" rel="noopener">${E(T('gh.cl.admin'))}</a> · <a href="${CLAUDE_HELP}" target="_blank" rel="noopener">${E(T('gh.cl.help'))}</a></p>
    <div class="gh-dbtns"><button class="btn" data-d="cancel">${E(T('gh.cancel'))}</button><button class="btn primary" data-d="open">${E(T('gh.cl.open'))}</button></div>`,
    act => { if (act === 'open') window.open(CLAUDE_CONNECT, '_blank', 'noopener'); });
  const copy = async () => { try { await navigator.clipboard.writeText(url); ui().toast(T('gh.claudeCopied')); } catch(e) { ov.querySelector('.gh-copy input').select(); } };
  ov.querySelector('[data-cl=copy]').addEventListener('click', copy);
  ov.querySelector('.gh-copy input').addEventListener('focus', e => e.target.select());
  copy();   // gleich beim Öffnen kopieren: oft reicht dann „Claude öffnen“
}

/* Anfragen landen als Issue im Bereich „wissen“ (oder im ersten Bereich der Organisation, den die Person sehen darf) */
const requestRepo = org => { const own = repos.filter(r => r.owner.login === org); return own.find(r => r.name === 'wissen') || own[0]; };
const REQ = '[Zugriff]';
function parseReq(i){
  const m = (i.body || '').match(/<!-- natively:(\{.*?\}) -->/);
  let d = {}; try { d = m ? JSON.parse(m[1]) : {}; } catch(e) {}
  return { id:i.number, user:d.user || (i.user && i.user.login), area:d.area || '', role:d.role || 'pull', reason:d.reason || '', url:i.html_url };
}
async function loadOrg(org){
  const o = orgInfo[org] ||= {};
  o.error = null;
  const safe = async (f, d) => { try { return await f(); } catch(e) { o.error = o.error || e.message; return d; } };
  const [info, members, admins, invites, teams, outside] = await Promise.all([
    safe(() => gh(`/orgs/${org}`), {}), safe(() => ghAll(`/orgs/${org}/members`), []), safe(() => ghAll(`/orgs/${org}/members?role=admin`), []),
    safe(() => ghAll(`/orgs/${org}/invitations`), []), safe(() => ghAll(`/orgs/${org}/teams`), []), safe(() => ghAll(`/orgs/${org}/outside_collaborators`), [])]);
  o.base = info.default_repository_permission; o.members = members; o.admins = new Set(admins.map(m => m.login)); o.invites = invites; o.outside = outside;
  o.teams = await pool(teams, 4, async tm => ({ ...tm, members:await safe(() => ghAll(`/orgs/${org}/teams/${tm.slug}/members`), []) }));
  const rr = requestRepo(org);
  o.requests = rr ? (await safe(() => ghAll(`/repos/${rr.full_name}/issues?state=open`), [])).filter(i => !i.pull_request && i.title.startsWith(REQ)).map(i => ({ ...parseReq(i), repo:rr.full_name })) : [];
}
const baseRole = b => ({ read:'pull', write:'push', admin:'admin' }[b] || b);
function orgPane(org){
  const o = orgInfo[org];
  if (!o || !o.members) {
    loadOrg(org).then(() => { if (adminRepo === 'org:' + org && document.getElementById('ghAdmin')) openAdmin(adminRepo); });
    return `<h3>${E(org)}</h3><p class="muted">${E(T('gh.loading'))}</p>`;
  }
  const teamsOf = login => o.teams.filter(tm => tm.members.some(m => m.login === login)).map(tm => tm.name);
  const ava = u => `<img class="gh-ava" src="${E(u.avatar_url)}&s=48" alt="">`;
  const warn = o.base && o.base !== 'none' ? `<p class="gh-note warn">${E(T('gh.baseWarn', { role:T('gh.role.' + baseRole(o.base)) }))} <button class="btn" data-gh="fixbase" data-org="${E(org)}">${E(T('gh.baseFixNow'))}</button></p>` : '';
  const reqs = o.requests.length ? `<h4>${E(T('gh.requests'))}</h4>` + o.requests.map((q, i) => `<div class="gh-person"><span class="txt">${E(T('gh.reqLine', { who:q.user, role:T('gh.role.' + q.role), area:q.area }))}${q.reason ? `<small class="gh-sub">${E(q.reason)}</small>` : ''}</span>
      <button class="btn" data-req-no="${i}">${E(T('gh.reject'))}</button><button class="btn primary" data-req-yes="${i}">${E(T('gh.approve'))}</button></div>`).join('') : '';
  const members = o.members.map(m => { const tl = teamsOf(m.login); return `<div class="gh-person">${ava(m)}<span class="txt">${E(m.login)}${o.admins.has(m.login) ? ` <small>${E(T('gh.owner'))}</small>` : ''}<small class="gh-sub">${E(tl.length ? tl.join(', ') : T('gh.noTeam'))}</small></span>
      ${me && m.login === me.login ? '' : `<button class="btn" data-org-rm="${E(m.login)}">${E(T('gh.orgRemove'))}</button>`}</div>`; }).join('');
  const teams = o.teams.map(tm => { const ids = new Set(tm.members.map(m => m.login)); const add = o.members.filter(m => !ids.has(m.login)); return `<div class="gh-team"><b>${E(tm.name)}</b>
      <span class="gh-chips">${tm.members.map(m => `<span class="gh-chip">${E(m.login)}<button data-team-rm="${E(tm.slug)}|${E(m.login)}" aria-label="${E(T('gh.remove'))}">${icon('x')}</button></span>`).join('') || `<small class="muted">${E(T('gh.teamEmpty'))}</small>`}</span>
      ${add.length ? `<select class="gh-role" data-team-add="${E(tm.slug)}"><option value="">${E(T('gh.addPerson'))}</option>${add.map(m => `<option value="${E(m.login)}">${E(m.login)}</option>`).join('')}</select>` : ''}</div>`; }).join('');
  const outside = o.outside.length ? `<h4>${E(T('gh.outside'))}</h4>` + o.outside.map(m => `<div class="gh-person">${ava(m)}<span class="txt">${E(m.login)}</span><button class="btn" data-out-rm="${E(m.login)}">${E(T('gh.orgRemove'))}</button></div>`).join('') : '';
  const invites = o.invites.length ? `<h4>${E(T('gh.invites'))}</h4>` + o.invites.map(i => `<div class="gh-person"><span class="txt">${E(i.login || i.email)}</span><button class="btn" data-org-revoke="${i.id}">${E(T('gh.revoke'))}</button></div>`).join('') : '';
  return `<h3>${E(org)} <small>${E(T('gh.org'))}</small></h3>
    <p class="muted">${E(T('gh.orgLead'))}</p>${warn}
    ${o.error ? `<p class="gh-note">${E(T('gh.failed', { msg:o.error }))}</p>` : ''}
    ${reqs}
    <h4>${E(T('gh.teams'))}</h4>${teams || `<p class="muted">${E(T('gh.noTeams'))}</p>`}
    <h4>${E(T('gh.people'))} · ${o.members.length}</h4>${members}
    ${outside}${invites}
    <form class="gh-invite gh-orginvite" data-form="orginvite"><input name="who" placeholder="${E(T('gh.orgInvitePh'))}" autocomplete="off" spellcheck="false" required>
      ${o.teams.length ? `<span class="gh-teampick">${o.teams.map(tm => `<label><input type="checkbox" name="team" value="${tm.id}"${tm.name === 'Alle' ? ' checked' : ''}>${E(tm.name)}</label>`).join('')}</span>` : ''}
      <button class="btn primary">${E(T('gh.invite'))}</button></form>`;
}
async function orgRun(org, fn, ok){
  try { await fn(); ui().toast(ok || T('gh.changed')); } catch(e) { ui().toast(T('gh.failed', { msg:e.message })); }
  await loadOrg(org); await loadAccess(); refreshOverview();
  if (document.getElementById('ghAdmin')) openAdmin(adminRepo);
}
async function decide(org, q, yes){
  const name = me ? me.login : '';
  await orgRun(org, async () => {
    if (yes) {
      if (!repos.some(r => r.full_name === `${org}/${q.area}`)) throw new Error(T('gh.noArea', { area:q.area }));
      await gh(`/repos/${org}/${q.area}/collaborators/${encodeURIComponent(q.user)}`, { method:'PUT', body:{ permission:q.role } });
    }
    await gh(`/repos/${q.repo}/issues/${q.id}/comments`, { method:'POST', body:{ body:(yes ? '✅ ' + T('gh.approvedBy', { who:name }) : '❌ ' + T('gh.rejectedBy', { who:name })) + ' (natively)' } });
    await gh(`/repos/${q.repo}/issues/${q.id}`, { method:'PATCH', body:{ state:'closed' } });
  }, T(yes ? 'gh.approved' : 'gh.rejected'));
}
/* Zugriff anfragen: jede Person, auch per Claude („Frag für mich Zugriff auf marketing an“) */
function requestAccess(){
  const orgs = orgsOf().filter(o => requestRepo(o));
  if (!orgs.length) { ui().toast(T('gh.reqNoOrg')); return; }
  const opt = v => `<option value="${v}">${E(T('gh.role.' + v))}</option>`;
  let ov;
  const q = sel => ov.querySelector(sel);
  ov = dialog(`<h3>${icon('folder-plus')}${E(T('gh.reqTitle'))}</h3><p>${E(T('gh.reqText'))}</p>
    <div class="gh-form">${orgs.length > 1 ? `<select class="gh-role" id="rqOrg">${orgs.map(o => `<option>${E(o)}</option>`).join('')}</select>` : ''}
      <input id="rqArea" placeholder="${E(T('gh.reqAreaPh'))}" autocomplete="off" spellcheck="false">
      <select class="gh-role" id="rqRole">${opt('pull')}${opt('push')}${opt('admin')}</select>
      <textarea id="rqWhy" rows="2" placeholder="${E(T('gh.reqWhyPh'))}"></textarea></div>
    <div class="gh-dbtns"><button class="btn" data-d="cancel">${E(T('gh.cancel'))}</button><button class="btn primary" data-d="send">${E(T('gh.reqSend'))}</button></div>`,
    async act => {
      if (act !== 'send') return;
      const org = q('#rqOrg') ? q('#rqOrg').value : orgs[0], area = q('#rqArea').value.trim(), role = q('#rqRole').value, reason = q('#rqWhy').value.trim();
      if (!area) { ui().toast(T('gh.reqNoAreaName')); return; }
      const rr = requestRepo(org), who = me ? me.login : '';
      const meta = JSON.stringify({ user:who, area, role, reason }).replace(/-->/g, '');
      try {
        await gh(`/repos/${rr.full_name}/issues`, { method:'POST', body:{ title:`${REQ} ${who}: ${T('gh.role.' + role)} in ${area}`,
          body:`${T('gh.reqLine', { who:'**' + who + '**', role:'**' + T('gh.role.' + role) + '**', area:'**' + area + '**' })}\n\n${reason ? '> ' + reason + '\n\n' : ''}${T('gh.reqHow')}\n\n<!-- natively:${meta} -->\n` } });
        ui().toast(T('gh.reqSent'));
      } catch(e) { ui().toast(T('gh.failed', { msg:e.message })); }
    });
  setTimeout(() => q('#rqArea') && q('#rqArea').focus(), 30);
}

let adminRepo = null;
function roleSelect(cur, attrs, personal){
  const opts = ['pull', 'push', 'admin'];
  const list = opts.includes(cur) ? opts : [cur, ...opts];
  return `<select class="gh-role" ${attrs} ${personal ? 'disabled' : ''}>${list.map(o => `<option value="${E(o)}"${o === cur ? ' selected' : ''}>${E(T('gh.role.' + o))}</option>`).join('')}</select>`;
}
function openAdmin(full){
  const admins = repos.filter(r => r.permissions && r.permissions.admin);
  const orgKeys = adminOrgs().map(o => 'org:' + o);
  const valid = k => k && (orgKeys.includes(k) || admins.some(r => r.full_name === k));
  adminRepo = full || (valid(adminRepo) ? adminRepo : orgKeys[0] || (admins[0] && admins[0].full_name));
  const orgView = adminRepo && adminRepo.startsWith('org:') ? adminRepo.slice(4) : null;
  let ov = document.getElementById('ghAdmin');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'ghAdmin'; ov.className = 'overlay gh-ov';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.target.closest('input')) { e.stopPropagation(); ov.remove(); } });
    ov.addEventListener('click', adminClick);
    ov.addEventListener('change', adminChange);
    ov.addEventListener('submit', adminSubmit);
  }
  const r = repos.find(x => x.full_name === adminRepo);
  const a = r && access[r.full_name] || { people:[], teams:[], invites:[] };
  const personal = r && r.owner.type === 'User';
  const people = r ? a.people.map(p => {
    const owner = p.login === r.owner.login;
    return `<div class="gh-person"><img class="gh-ava" src="${E(p.avatar_url)}&s=48" alt=""><span class="txt">${E(p.login)}${owner ? ` <small>${E(T('gh.owner'))}</small>` : ''}</span>
      ${owner ? `<span class="gh-rolelbl">${E(T('gh.role.admin'))}</span>` : roleSelect(roleKey(p), `data-person="${E(p.login)}"`, personal)}
      ${owner ? '' : `<button class="iconbtn" data-remove="${E(p.login)}" title="${E(T('gh.remove'))}" aria-label="${E(T('gh.remove'))}">${icon('x')}</button>`}</div>`;
  }).join('') : '';
  const invites = r && a.invites.length ? `<h4>${E(T('gh.invites'))}</h4>` + a.invites.map(i => `<div class="gh-person"><span class="txt">${E(i.invitee ? i.invitee.login : i.email)}</span>
      <span class="gh-rolelbl">${E(T('gh.role.' + (i.permissions === 'write' ? 'push' : i.permissions === 'read' ? 'pull' : i.permissions)))}</span>
      <button class="btn" data-revoke="${i.id}">${E(T('gh.revoke'))}</button></div>`).join('') : '';
  const teams = r && a.teams.length ? `<h4>${E(T('gh.teams'))}</h4>` + a.teams.map(tm => `<div class="gh-person"><span class="txt">${E(tm.name)}</span>${roleSelect(tm.permission, `data-team="${E(tm.slug)}"`)}</div>`).join('') : '';
  ov.innerHTML = `<div class="gh-dialog gh-admin" role="dialog" aria-modal="true" aria-label="${E(T('gh.adminTitle'))}">
    <div class="gh-ahead"><b>${E(T('gh.adminTitle'))}</b><button class="iconbtn" data-close aria-label="${E(T('close'))}">${icon('x')}</button></div>
    <div class="gh-abody">
      <nav class="gh-areas">${orgKeys.length ? `<div class="nsec-h">${E(T('gh.org'))}</div>` + orgKeys.map(k => `<button class="nitem${k === adminRepo ? ' on' : ''}" data-area="${E(k)}">${icon('sliders')}<span class="lbl">${E(k.slice(4))}</span>${orgInfo[k.slice(4)] && orgInfo[k.slice(4)].requests && orgInfo[k.slice(4)].requests.length ? `<span class="count">${orgInfo[k.slice(4)].requests.length}</span>` : ''}</button>`).join('') : ''}
        <div class="nsec-h">${E(T('gh.areas'))}</div>
        ${admins.map(x => `<button class="nitem${x.full_name === adminRepo ? ' on' : ''}" data-area="${E(x.full_name)}">${icon(x.private ? 'drive' : 'cloud')}<span class="lbl">${E(x.name)}</span></button>`).join('') || `<p class="muted">${E(T('gh.noAdmin'))}</p>`}
        <form class="gh-new" data-form="new"><input name="name" placeholder="${E(T('gh.newAreaPh'))}" autocomplete="off" spellcheck="false" pattern="[A-Za-z0-9._-]+" required><button class="btn">${icon('plus')}${E(T('gh.create'))}</button></form>
      </nav>
      <section class="gh-apane">${orgView ? orgPane(orgView) : r ? `
        <h3>${E(r.name)} <small>${E(r.full_name)}</small></h3>
        <p class="muted">${E(T('gh.adminLead'))}</p>
        ${personal ? `<p class="gh-note">${E(T('gh.personal'))}</p>` : ''}
        ${a.error ? `<p class="gh-note">${E(T('gh.failed', { msg:a.error }))}</p>` : ''}
        ${teams}
        <h4>${E(T('gh.people'))}</h4>${people}
        ${invites}
        <form class="gh-invite" data-form="invite"><input name="who" placeholder="${E(T('gh.invitePh'))}" autocomplete="off" spellcheck="false" required>${roleSelect('push', 'name="role"', personal)}<button class="btn primary">${E(T('gh.invite'))}</button></form>` : ''}
      </section>
    </div></div>`;
}
async function adminRun(fn, ok){
  const again = () => { if (document.getElementById('ghAdmin')) openAdmin(adminRepo); };
  try { await fn(); await loadAccess(); refreshOverview(); again(); if (ok) ui().toast(ok); }
  catch(e) { ui().toast(T('gh.failed', { msg:e.message })); again(); }
}
function adminClick(e){
  const b = e.target.closest('[data-close],[data-area],[data-remove],[data-revoke],[data-req-yes],[data-req-no],[data-org-rm],[data-out-rm],[data-team-rm],[data-org-revoke]');
  if (!b) return;
  const org = adminRepo && adminRepo.startsWith('org:') ? adminRepo.slice(4) : null, o = org && orgInfo[org], d = b.dataset;
  if (org) {
    if (d.reqYes) { decide(org, o.requests[+d.reqYes], true); return; }
    if (d.reqNo) { decide(org, o.requests[+d.reqNo], false); return; }
    if (d.orgRm) { if (confirm(T('gh.orgRemoveAsk', { who:d.orgRm, org }))) orgRun(org, () => gh(`/orgs/${org}/memberships/${encodeURIComponent(d.orgRm)}`, { method:'DELETE' })); return; }
    if (d.outRm) { if (confirm(T('gh.orgRemoveAsk', { who:d.outRm, org }))) orgRun(org, () => gh(`/orgs/${org}/outside_collaborators/${encodeURIComponent(d.outRm)}`, { method:'DELETE' })); return; }
    if (d.teamRm) { const [slug, who] = d.teamRm.split('|'); orgRun(org, () => gh(`/orgs/${org}/teams/${slug}/memberships/${encodeURIComponent(who)}`, { method:'DELETE' })); return; }
    if (d.orgRevoke) { orgRun(org, () => gh(`/orgs/${org}/invitations/${d.orgRevoke}`, { method:'DELETE' })); return; }
  }
  if (b.hasAttribute('data-close')) { document.getElementById('ghAdmin').remove(); return; }
  if (b.dataset.area) { openAdmin(b.dataset.area); return; }
  if (b.dataset.remove) {
    if (!confirm(T('gh.removeAsk', { who:b.dataset.remove, area:adminRepo }))) return;
    adminRun(() => gh(`/repos/${adminRepo}/collaborators/${encodeURIComponent(b.dataset.remove)}`, { method:'DELETE' }), T('gh.changed'));
  }
  if (b.dataset.revoke) adminRun(() => gh(`/repos/${adminRepo}/invitations/${b.dataset.revoke}`, { method:'DELETE' }), T('gh.changed'));
}
function adminChange(e){
  const s = e.target;
  if (s.dataset.teamAdd && s.value) { const org = adminRepo.slice(4); orgRun(org, () => gh(`/orgs/${org}/teams/${s.dataset.teamAdd}/memberships/${encodeURIComponent(s.value)}`, { method:'PUT', body:{ role:'member' } })); return; }
  if (s.dataset.person) adminRun(() => gh(`/repos/${adminRepo}/collaborators/${encodeURIComponent(s.dataset.person)}`, { method:'PUT', body:{ permission:s.value } }), T('gh.changed'));
  if (s.dataset.team) { const [org] = adminRepo.split('/'); adminRun(() => gh(`/orgs/${org}/teams/${s.dataset.team}/repos/${adminRepo}`, { method:'PUT', body:{ permission:s.value } }), T('gh.changed')); }
}
function adminSubmit(e){
  e.preventDefault();
  const form = e.target, fd = new FormData(form);
  if (form.dataset.form === 'invite') {
    const who = String(fd.get('who') || '').trim().replace(/^@/, '');
    if (who) adminRun(() => gh(`/repos/${adminRepo}/collaborators/${encodeURIComponent(who)}`, { method:'PUT', body:{ permission:fd.get('role') || 'push' } }), T('gh.invited', { who }));
  }
  if (form.dataset.form === 'new') createArea(String(fd.get('name') || '').trim());
  if (form.dataset.form === 'orginvite') {
    const org = adminRepo.slice(4), who = String(fd.get('who') || '').trim().replace(/^@/, ''), team_ids = fd.getAll('team').map(Number);
    if (who) orgRun(org, async () => {
      const body = who.includes('@') ? { email:who } : { invitee_id:(await gh(`/users/${encodeURIComponent(who)}`)).id };
      await gh(`/orgs/${org}/invitations`, { method:'POST', body:{ ...body, role:'direct_member', team_ids } });
      const link = `${location.origin}/?join=${encodeURIComponent(org)}`;
      try { await navigator.clipboard.writeText(link); } catch(e) {}
    }, T('gh.invitedLink', { who, link:`${location.origin}/?join=${org}` }));
  }
}
/* Neuer Bereich = neues privates Repo mit einer ersten MD-Datei, beim eigenen Konto oder in der Organisation des gewählten Bereichs */
async function createArea(name, owner, first){
  if (!name) return;
  const base = repos.find(x => x.full_name === adminRepo);
  owner = owner || (base ? { login:base.owner.login, type:base.owner.type } : installs[0]);
  const org = owner && owner.type === 'Organization' ? owner.login : null;
  const de = LANG === 'de', d = new Date().toLocaleDateString(de ? 'de-DE' : 'en-US');
  const text = first
    ? (de ? `# ${name}\n\nEuer erster Bereich in natively. Stand: ${d}.\n\n## So geht es weiter\n\n- In diesen Text klicken und tippen, mit ⌘S speichern. Jede Änderung wird eine Version.\n- Unter **Admin** Leute einladen und Rechte vergeben.\n- Über **Claude verbinden** den natively-Connector einrichten und Claude Dateien schreiben lassen.\n`
          : `# ${name}\n\nYour first area in natively. As of ${d}.\n\n## Next steps\n\n- Click into this text and type, save with ⌘S. Every change becomes a version.\n- Invite people and assign rights under **Admin**.\n- Set up the natively connector via **Connect Claude** and let Claude write files.\n`)
    : `# ${name}\n\n${de ? 'Neuer Bereich. Stand: ' : 'New area. As of '}${d}.\n`;
  try {
    const r = await gh(org ? `/orgs/${org}/repos` : '/user/repos', { method:'POST', body:{ name, private:true, auto_init:false, description:'natively' } });
    await gh(`/repos/${r.full_name}/contents/README.md`, { method:'PUT', body:{ message:(de ? 'Bereich angelegt' : 'Area created') + ' (natively)', content:toB64(text) } });
    ui().toast(T('gh.created', { name }));
    adminRepo = r.full_name;
    await reload();
    if (first) ui().openFile(srcId(r) + '|README.md', { pin:true });
    else openAdmin(r.full_name);
  } catch(e) { ui().toast(T('gh.failed', { msg:e.message })); }
}
function newArea(){ openAdmin(); const i = document.querySelector('#ghAdmin [name="name"]'); if (i) i.focus(); }
function refreshOverview(){ if (!auth) return; ui().apply({ upserts:[overviewFile()] }); }
async function reload(){ const d = await scan(); ui().apply({ full:d }); }
async function installUrl(){
  try { const j = await (await fetch('/api/auth/config')).json(); return j.installUrl; } catch(e) { return null; }
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-gh]');
  if (!b) return;
  const a = b.dataset.gh;
  if (a === 'signin') signIn();
  if (a === 'signout') signOut();
  if (a === 'admin') { Object.values(orgInfo).forEach(o => { o.members = null; }); openAdmin(); }   // immer frisch von GitHub
  if (a === 'request') requestAccess();
  if (a === 'join') join(b.dataset.org);
  if (a === 'setup') { b.disabled = true; b.textContent = T('gh.settingUp'); await setupOrg(b.dataset.org); }
  if (a === 'claude') connectClaude();   // eigener natively-Connector: speichert immer direkt auf main, nur .md
  if (a === 'fixbase') { const org = b.dataset.org; orgRun(org, () => gh(`/orgs/${org}`, { method:'PATCH', body:{ default_repository_permission:'none' } })); }
  if (a === 'save' || a === 'savenow') saveNow();
  if (a === 'conflict') { const f = curF(); if (f) conflict(f.id); }
  if (a === 'versions') { document.querySelectorAll('.menu').forEach(m => m.remove()); const f = curF(); if (f) ui().openView('verlauf:file:' + f.id); }
  if (a === 'timeline') ui().openView('verlauf');
  if (a === 'neworg') { window.open(NEW_ORG_URL, '_blank', 'noopener'); orgStepDone(); }
  if (a === 'orgdone') orgStepDone();
  if (a === 'start') { const u = await installUrl(); if (u) location.href = u; else ui().toast(T('gh.notConfigured')); }
  if (a === 'first') { b.disabled = true; await createArea('wissen', installs[0], true); b.disabled = false; }
  if (a === 'install') { const u = await installUrl(); if (u) window.open(u, '_blank', 'noopener'); else ui().toast(T('gh.notConfigured')); }
});
/* „Anmelden“ im leeren Baum führt zur Startseite mit dem Anmelde-Knopf */
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveNow();
  }
}, true);
/* Klick außerhalb des Absatzes beendet das Bearbeiten (auch ohne Fokuswechsel) */
document.addEventListener('mousedown', e => { if (editing && !editing.raw && e.target !== editing.ta && !e.target.closest('#ghStatus')) editing.done(); }, true);
/* Tab wird geschlossen: Entwurf ist schon im Browser gesichert. Offene Änderungen sofort abschicken (keepalive) und warnen. */
let leaving = false;
window.addEventListener('beforeunload', e => {
  if (editing && !editing.raw) editing.done();
  persistDrafts();
  const open = Object.entries(dirty).filter(([, d]) => !d.conflict);
  if (!open.length || leaving) return;
  for (const [id, d] of open) if (!d.saving) { clearTimeout(d.timer); doSave(id, { keepalive:true, newVersion:true }); }
  e.preventDefault(); e.returnValue = T('gh.leaveAsk');
});
/* Link aus Claude: /?open=owner/bereich/ordner/datei.md öffnet die Datei. Bleibt über das Anmelden hinweg erhalten. */
const OPEN_KEY = 'natively:gh:open';
(function(){ const o = new URLSearchParams(location.search).get('open'); if (!o) return; try { sessionStorage.setItem(OPEN_KEY, o); } catch(e) {} history.replaceState(null, '', location.pathname); })();
function takeOpen(){ let o = null; try { o = sessionStorage.getItem(OPEN_KEY); sessionStorage.removeItem(OPEN_KEY); } catch(e) {} return o; }
function openWanted(o){
  const parts = String(o).replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 3 || !ui()) return;
  const full = (parts[0] + '/' + parts[1]).toLowerCase(), path = parts.slice(2).join('/');
  const r = repos.find(x => x.full_name.toLowerCase() === full);
  const id = r && srcId(r) + '|' + path;
  if (id && data && data.files.some(f => f.id === id)) ui().openFile(id, { pin:true });
  else ui().toast(T('gh.openMissing'));
}
/* Anmelden kam gerade zurück: Fehler zeigen */
const qs = new URLSearchParams(location.search);
if (qs.has('setup_action') || qs.has('installation_id')) history.replaceState(null, '', location.pathname);   // zurück von „Install“ bei GitHub
const err = qs.get('gh_error');
if (err) { history.replaceState(null, '', location.pathname); setTimeout(() => ui() && ui().toast(T('gh.failed', { msg:err })), 300); }

window.nativelyGitHub = { cmd, card, teamRecent:() => auth && recent.length ? `<section class="card gh-recentcard">${recentHtml()}</section>` : '', afterDoc, newArea, openAdmin, reload, saveNow, poll, openVersions,
  menu:f => f && repoOf(f) && !f.virtual ? `<button role="menuitem" data-gh="versions">${icon('clock')}${E(T('gh.versions'))}</button>` : '',
  renderView, viewName, navState,
  get dirty(){ return dirty; }, get heads(){ return heads; }, get sessions(){ return sessions; }, get editing(){ return editing; }, _tab:TAB,
  _testAuth:v => { if (window.NATIVELY_API) auth = v; } };   // nur mit Testdaten
})();
