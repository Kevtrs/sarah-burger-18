# Sarah Burger 18 ans

Application web de commande de cheeseburgers pour les 18 ans de Sarah.

Le front est une app React/Vite statique publiable sur GitHub Pages. En production, les commandes passent par Firebase Realtime Database avec Firebase Authentication : les invités sont connectés en anonyme, la cuisine utilise un compte Email/Password autorisé par UID.

## Accès

- Invités : `/#commande`
- Cuisine : `/#stand`

L'URL `#stand` n'est pas une protection. L'accès cuisine est protégé par Firebase Auth et par la liste `kitchenUsers`.

URL GitHub Pages attendue :

```txt
https://VOTRE_USER.github.io/VOTRE_REPO/
```

Si le dépôt s'appelle `sarah-burger-18`, l'URL sera par exemple :

```txt
https://VOTRE_USER.github.io/sarah-burger-18/
```

## Architecture

- `src/services/firebase.js` : initialisation Firebase isolée.
- `src/services/auth.js` : connexion anonyme invité, connexion cuisine Email/Password, vérification UID cuisine.
- `src/services/orders.js` : création, lecture temps réel, mise à jour des statuts, mode local de développement.
- `src/services/session.js` : session `sarah-18-2026`, état réseau Firebase, archivage de session.
- `src/services/firebaseMessaging.js` : enregistrement du service worker FCM et récupération du token Web Push.
- `src/hooks/usePushNotifications.js` : activation push après clic utilisateur, compatibilité navigateur, messages iPhone.
- `src/components/PushNotificationPrompt.jsx` : bouton `M'avertir quand c'est prêt` et fallback visuel.
- `public/firebase-messaging-sw.js` : service worker FCM généré avant `dev` et `build`.
- `public/manifest.webmanifest` : manifest PWA compatible GitHub Pages.
- `functions/index.js` : Cloud Function sécurisée qui envoie le push quand une commande passe à `ready`.
- `firebase.rules.json` : règles Realtime Database de production.
- `.github/workflows/deploy.yml` : build Vite puis déploiement officiel GitHub Pages.

Le mode local reste disponible si Firebase n'est pas configuré. Il sert aux tests sur un seul navigateur et ne synchronise pas plusieurs téléphones.

## Assets utilisés

- `sarah-logo.svg` : identité principale.
- `menu-reference.svg` : burger de base.
- `checker.svg` : motif de fond.
- `pickles.svg`, `jalapeno.svg`, `onions.svg` : ajouts.
- `bigmac.svg`, `giant.svg`, `mayo.svg`, `ketchup.svg`, `spicy.svg` : sauces.

Les illustrations originales ne sont pas modifiées.

## Installation locale

```bash
npm install
npm run dev
```

Pour lancer sur le port utilisé par la validation :

```bash
npm run dev -- --port 5178
```

Commandes utiles :

```bash
npm run lint
npm run build
npm run preview
npm run validate
```

`npm run validate` attend l'app sur `http://127.0.0.1:5178/`.

## Variables d'environnement

Créer un fichier `.env.local` depuis `.env.example`.

```env
VITE_GITHUB_PAGES_REPO=sarah-burger-18
VITE_BASE_PATH=/sarah-burger-18/
VITE_EVENT_ID=sarah-18-2026
VITE_EVENT_NAME=18 ans de Sarah
VITE_FIRST_ORDER_NUMBER=18
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
VITE_PUBLIC_SITE_URL=https://kevtrs.github.io/sarah-burger-18/
```

Les variables `VITE_FIREBASE_*` sont la configuration publique Web Firebase. Elles ne sont pas des clés administrateur et ne doivent pas donner de droits seules. Les vrais droits sont dans Firebase Authentication et dans `firebase.rules.json`.

`VITE_BASE_PATH` peut être omise en GitHub Actions : le workflow utilise automatiquement le nom du dépôt.

`VITE_FIREBASE_VAPID_KEY` est la clé publique Web Push. Ce n'est pas une clé serveur. Ne jamais mettre de clé privée FCM ou de fichier service account dans le front.

Variables côté Functions :

```bash
FUNCTION_REGION=europe-west1
SARAH_BURGER_PUBLIC_SITE_URL=https://kevtrs.github.io/sarah-burger-18/
```

## Configuration Firebase

1. Créer un projet sur Firebase.
2. Ajouter une application Web dans les paramètres du projet.
3. Copier la config Web dans `.env.local` et dans les variables GitHub Actions.
4. Activer Authentication.
5. Activer les fournisseurs :
   - Anonymous ;
   - Email/Password.
6. Créer une Realtime Database en mode verrouillé, pas en mode test.
7. Choisir une région proche, par exemple Europe si disponible.
8. Activer Cloud Messaging :
   - Firebase Console > Project settings > Cloud Messaging.
   - Dans `Web Push certificates`, générer une paire de clés.
   - Copier la clé publique dans `VITE_FIREBASE_VAPID_KEY`.
   - Ne jamais copier la clé privée dans GitHub ou dans le front.
9. Déployer les règles de `firebase.rules.json`.

Déploiement des règles avec Firebase CLI :

```bash
npm install -g firebase-tools
firebase login
firebase use VOTRE_PROJECT_ID
firebase deploy --only database
```

Alternative : copier le contenu de `firebase.rules.json` dans Firebase Console > Realtime Database > Rules, puis publier.

## Notifications push Web

Le bouton `M'avertir quand c'est prêt` fonctionne ainsi :

1. l'invité crée une commande ;
2. il appuie volontairement sur le bouton ;
3. l'app demande l'autorisation navigateur ;
4. Firebase Messaging fournit un token FCM ;
5. le token est stocké sous `sessions/sarah-18-2026/pushSubscriptions/{orderId}/{subscriptionId}` avec `ownerUid`;
6. la cuisine passe la commande à `ready`;
7. la Cloud Function envoie un push data-only via Firebase Admin ;
8. au premier plan, React affiche l'alerte visuelle ;
9. en arrière-plan ou onglet fermé, `firebase-messaging-sw.js` affiche la notification système.

Payload envoyé :

```txt
Titre : Ton burger est prêt 🍔
Texte : Commande #XX — viens la récupérer au stand Sarah Burger.
URL   : https://kevtrs.github.io/sarah-burger-18/#commande
Data  : type=order-ready, orderId, orderNumber
```

Les tokens ne sont pas stockés dans l'objet public principal de commande. Les invités ne peuvent lire que leur propre abonnement. La cuisine n'a pas besoin de lire les tokens.

Sur iPhone/iPad, le vrai Web Push nécessite généralement l'installation de la PWA :

1. ouvrir le site dans Safari ;
2. ouvrir le menu Partager ;
3. choisir `Sur l'écran d'accueil` ;
4. ouvrir Sarah Burger depuis l'icône installée ;
5. appuyer sur `M'avertir quand c'est prêt` ;
6. autoriser les notifications.

Dans un simple onglet Safari non installé, l'app garde seulement l'alerte visuelle tant que la page reste ouverte.

## Cloud Functions

Important : le déploiement de Firebase Cloud Functions nécessite généralement le plan Blaze. Ne passe pas au plan Blaze sans validation explicite.

Installation locale :

```bash
npm --prefix functions install
npm --prefix functions run lint
npm --prefix functions test
```

Déploiement, après validation du plan Blaze et du projet Firebase :

```bash
npm install -g firebase-tools
firebase login
firebase use VOTRE_PROJECT_ID
firebase deploy --only functions
```

Pour déployer seulement la Function de notification :

```bash
firebase deploy --only functions:sendReadyNotification
```

Pour consulter les logs :

```bash
firebase functions:log --only sendReadyNotification
```

La Function écoute :

```txt
sessions/sarah-18-2026/orders/{orderId}/status
```

Elle envoie uniquement sur les transitions :

```txt
received -> ready
preparing -> ready
```

Elle ignore `ready -> served`, `ready -> cancelled`, `ready -> ready`, la création initiale déjà `ready`, et les commandes sans abonnement actif. L'idempotence est gardée dans :

```txt
sessions/sarah-18-2026/readyNotifications/{orderId}
```

## Compte cuisine

1. Firebase Console > Authentication > Users.
2. Créer un utilisateur Email/Password, par exemple `cuisine@sarah-burger.local`.
3. Choisir un mot de passe fort et le communiquer uniquement à l'équipe cuisine.
4. Copier l'UID du compte.
5. Dans Realtime Database > Data, ajouter :

```json
{
  "kitchenUsers": {
    "UID_DU_COMPTE_CUISINE": true
  }
}
```

Aucun mot de passe n'est stocké dans le dépôt. Seul l'UID autorisé est en base.

## Règles Firebase

Les règles de `firebase.rules.json` appliquent ces principes :

- aucun accès public complet ;
- invité authentifié anonyme : peut créer une commande dans la session et lire uniquement sa commande directe ;
- cuisine : doit être connectée avec un UID présent dans `kitchenUsers`, peut lire et modifier toutes les commandes ;
- suppression interdite depuis l'app ;
- statuts autorisés : `received`, `preparing`, `ready`, `served`, `cancelled`;
- compteur `lastNumber` incrémenté de `+1` uniquement ;
- tokens push séparés sous `pushSubscriptions`, lisibles uniquement par leur `ownerUid`;
- champs serveur de notification (`notificationSent`, `notifiedAtMs`, `lastError`) réservés à Firebase Admin ;
- session archivée : les invités ne peuvent plus créer de commande.

Les commandes sont stockées sous :

```txt
sessions/sarah-18-2026/orders/{clientRequestId}
```

## Numéros et temps réel

La création de commande :

1. connecte l'invité en anonyme ;
2. vérifie la connexion réseau ;
3. réserve un numéro via transaction atomique sur `meta/lastNumber` ;
4. écrit la commande avec `serverTimestamp()`;
5. affiche l'écran de confirmation seulement après réussite de l'écriture.

Un `clientRequestId` stable empêche les doubles envois par double-clic ou retry. La cuisine reçoit les commandes via abonnement temps réel Realtime Database.

## Déploiement GitHub Pages

1. Pousser le projet sur GitHub.
2. Dans GitHub > Settings > Pages, choisir `GitHub Actions`.
3. Dans GitHub > Settings > Secrets and variables > Actions > Variables, créer :

```txt
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_VAPID_KEY
```

4. Pousser sur `main`.
5. Le workflow `.github/workflows/deploy.yml` exécute `npm ci`, `npm run build`, puis publie `dist`.

Le build GitHub Actions génère aussi `public/firebase-messaging-sw.js` avec les variables `VITE_FIREBASE_*`. Vérifier après build que `dist/firebase-messaging-sw.js` existe.

## Procédure de test

Test local sans Firebase :

```bash
npm run dev -- --port 5178
npm run validate
```

Test production avec Firebase :

1. Ouvrir `/#commande` dans deux onglets ou deux téléphones.
2. Envoyer deux commandes presque en même temps.
3. Vérifier dans `/#stand` que les deux numéros sont différents.
4. Passer une commande en mode avion : l'app doit afficher l'état hors ligne et le bouton `Réessayer`.
5. Réactiver le réseau, cliquer `Réessayer`, vérifier que le ticket apparaît seulement après confirmation.
6. Passer une commande en `preparing`, `ready`, `served`, puis tester `cancelled`.
7. Archiver la session depuis la cuisine et vérifier qu'un invité ne peut plus commander.
8. Tester les largeurs 360, 390, 430, 768 et desktop.

Test push réel :

1. déployer le front sur GitHub Pages ;
2. déployer les règles RTDB ;
3. déployer `sendReadyNotification` ;
4. ouvrir `https://kevtrs.github.io/sarah-burger-18/#commande` sur Chrome Android ou Chrome/Edge desktop ;
5. créer une commande ;
6. appuyer sur `M'avertir quand c'est prêt` et autoriser ;
7. vérifier dans Realtime Database que `pushSubscriptions/{orderId}/{subscriptionId}` existe ;
8. fermer l'onglet client ;
9. ouvrir `/#stand` avec le compte cuisine ;
10. passer la commande `received -> preparing`, vérifier qu'aucun push n'arrive ;
11. passer `preparing -> ready`, vérifier une seule notification système ;
12. cliquer la notification, vérifier le retour sur `#commande` ;
13. remettre `ready`, modifier un autre champ ou recharger la cuisine : aucune deuxième notification ne doit partir ;
14. consulter `firebase functions:log --only sendReadyNotification`.

Test token invalide :

1. dans `pushSubscriptions/{orderId}`, remplacer temporairement un token par une chaîne invalide longue ;
2. passer cette commande à `ready` en environnement de test ;
3. vérifier dans les logs que l'erreur est capturée ;
4. vérifier que l'abonnement invalide est supprimé.

## Procédure de secours le jour J

- Garder un ordinateur connecté à `/#stand` et un téléphone test connecté à `/#commande`.
- Si le Wi-Fi tombe, faire patienter les invités : l'app garde le bouton `Réessayer` tant que la commande n'est pas confirmée.
- Si Firebase est indisponible longtemps, passer temporairement en prise de commandes orale avec le tableau cuisine sur un seul appareil en mode local non synchronisé.
- Si la session a été archivée par erreur, retirer ou remettre `false` sur `sessions/sarah-18-2026/meta/archived` depuis Firebase Console avec un compte propriétaire du projet.
- Ne pas repasser la base en mode test.

## Choix techniques

- React + Vite : app statique, légère, publiable sur GitHub Pages.
- Firebase Realtime Database : abonnement temps réel simple pour 50 à 60 invités.
- Firebase Authentication : invités anonymes et cuisine protégée par Email/Password + UID autorisé.
- Realtime Database transaction : numéros de commande réservés sans `orders.length`.
- Fallback localStorage : développement possible sans serveur Node personnel.
