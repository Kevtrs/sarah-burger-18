# Sarah Burger LED Bridge

Ce dossier contient le programme Windows qui affiche les commandes Sarah Burger sur un mur LED Bluetooth 64x64 compose de quatre panneaux 32x32.

Le bridge ne depend plus du navigateur. Il ecoute directement Firebase Realtime Database, dessine une image virtuelle 64x64, la decoupe en quatre images 32x32, puis envoie chaque morceau au bon panneau avec `pypixelcolor`.

## 1. A quoi ca sert

Pendant la soiree :

1. les invites commandent sur Sarah Burger ;
2. la cuisine change les statuts dans `/#stand` ;
3. ce programme voit les changements dans Firebase ;
4. le mur LED affiche le numero de commande.

Affichage :

- `received` : numero + `RECU`
- `preparing` : numero + `CUIT`
- `ready` : numero + `PRET`
- `served` : numero + `SERVI`
- `cancelled` : numero + `ANNULE`

La page web continue de fonctionner meme si le bridge est ferme, si Bluetooth coupe ou si un panneau n'est pas allume.

## 2. Telecharger la bonne branche

Depuis GitHub :

1. ouvrir `https://github.com/Kevtrs/sarah-burger-18` ;
2. choisir la branche `feature/led-panel-bridge` ;
3. cliquer sur `Code` puis `Download ZIP` ;
4. extraire le ZIP sur le PC Windows du stand ;
5. ouvrir le dossier `tools/led-bridge`.

## 3. Installer Python

Installer Python depuis :

```text
https://www.python.org/downloads/windows/
```

Pendant l'installation, cocher :

```text
Add python.exe to PATH
```

Puis fermer et rouvrir l'explorateur Windows.

## 4. Installer le bridge

Dans `tools/led-bridge`, double-cliquer sur :

```text
INSTALLER.bat
```

Le script :

- verifie Python ;
- cree `.venv` ;
- installe les dependances ;
- verifie `pypixelcolor` ;
- cree `config.json` si absent ;
- cree le dossier `assets`.

Il ne supprime pas les fichiers existants.

## 5. Configurer Firebase

Le bridge lit Firebase avec un fichier local secret. Ce fichier ne doit jamais etre pousse sur GitHub.

Dans Firebase Console :

1. ouvrir le projet `sarah-burger-18` ;
2. aller dans `Project settings` ;
3. ouvrir l'onglet `Service accounts` ;
4. cliquer sur `Generate new private key` ;
5. telecharger le fichier JSON ;
6. le renommer exactement :

```text
service-account.json
```

7. le placer dans :

```text
tools/led-bridge/service-account.json
```

Ce fichier est ignore par Git.

## 6. Verifier config.json

Apres `INSTALLER.bat`, ouvrir :

```text
tools/led-bridge/config.json
```

Verifier :

```json
{
  "firebase": {
    "database_url": "https://sarah-burger-18-default-rtdb.europe-west1.firebasedatabase.app",
    "service_account_path": "service-account.json",
    "session_id": "sarah-18-2026"
  },
  "panel": {
    "ready_display_seconds": 20,
    "status_display_seconds": 3,
    "rotation_seconds": 3,
    "reconnect_delay_seconds": 5,
    "brightness": null
  },
  "wall": {
    "panels": {
      "top_left": "67:4D:FB:6D:7D:EE",
      "top_right": "4C:E7:31:A8:23:DC",
      "bottom_left": "2A:C0:17:D2:EB:9B",
      "bottom_right": "6A:0B:5F:BC:79:7B"
    }
  },
  "behavior": {
    "queue_existing_ready_on_start": false
  },
  "generated_dir": "generated"
}
```

`ready_display_seconds` controle la duree d'affichage d'une commande prete.
`rotation_seconds` controle la rotation quand plusieurs commandes actives sont affichees.

## 7. Disposition des panneaux

Le mur LED est utilise comme un seul ecran 64x64 :

```text
+----------------+----------------+
| top_left       | top_right      |
| 67:4D:...      | 4C:E7:...      |
+----------------+----------------+
| bottom_left    | bottom_right   |
| 2A:C0:...      | 6A:0B:...      |
+----------------+----------------+
```

Aucun GIF n'est utilise. Le firmware n'affiche pas correctement les animations GIF.

## 8. Tester le panneau

Fermer iPixel Color et toute autre application connectee au panneau.

Verifier :

- les quatre panneaux sont charges ;
- le Bluetooth du PC est active ;
- les panneaux ne sont pas connectes a un telephone ;
- les quatre adresses Bluetooth sont bien dans `config.json`.

Puis double-cliquer :

```text
TESTER.bat
```

Le mur doit afficher :

```text
#27 PRET
```

Ce test ne cree aucune vraie commande dans Sarah Burger.

## 9. Lancer le bridge pendant la soiree

Double-cliquer :

```text
LANCER.bat
```

Laisser la fenetre ouverte.

Logs attendus :

```text
[14:32:01] Sarah Burger LED Bridge
[14:32:01] Firebase connecte
[14:32:04] Haut gauche connecte: 32x32
[14:33:12] Commande #27 -> PRETE
[14:33:14] Image envoyee
```

## 10. Ouvrir la page du stand

Sur le meme PC ou sur un autre appareil autorise :

```text
https://kevtrs.github.io/sarah-burger-18/#stand
```

Connecter le compte cuisine, puis changer les statuts normalement.

Le bridge ecoute Firebase directement. Il detecte donc aussi les changements faits depuis un autre ordinateur ou telephone cuisine.

## 11. File des commandes pretes

Au demarrage, le bridge lit Firebase pour connaitre l'etat actuel.
Il ignore les anciennes commandes servies ou annulees, puis affiche seulement les commandes encore actives.

Quand une commande passe a `ready`, elle est placee dans une file.

Si plusieurs burgers deviennent prets en meme temps :

- chaque numero est affiche ;
- l'ordre d'arrivee est conserve ;
- une commande prete n'est pas perdue ;
- un doublon `ready -> ready` est ignore.

Une commande `received` ou `preparing` reste affichee tant qu'aucun statut plus important n'arrive.
S'il y a plusieurs commandes actives, elles tournent toutes les `rotation_seconds`.
Apres une commande `ready`, `served` ou `cancelled`, le panneau revient a l'attente ou au prochain etat disponible.

## 12. Si le panneau ne se connecte pas

Verifier :

1. Bluetooth Windows est active ;
2. iPixel Color est ferme ;
3. aucun panneau n'est connecte a un autre appareil ;
4. les adresses dans `config.json` sont correctes ;
5. les panneaux sont assez charges ;
6. relancer `LANCER.bat`.

Si besoin, supprimer l'appairage Bluetooth Windows du panneau, puis le reconnecter.

## 13. Si Firebase ne repond pas

Verifier :

1. internet fonctionne sur le PC ;
2. `service-account.json` est bien present ;
3. `database_url` est correct ;
4. `session_id` vaut `sarah-18-2026` ;
5. le projet Firebase existe toujours.

Ne mets pas les regles Firebase en mode test.

## 14. Si l'image ne change pas

Verifier :

1. la fenetre `LANCER.bat` affiche des logs ;
2. la commande change bien de statut dans la cuisine ;
3. `TESTER.bat` fonctionne ;
4. le panneau n'est pas connecte a iPixel Color ;
5. les quatre panneaux sont allumes et proches du PC.

## 15. Arreter proprement

Dans la fenetre du bridge :

```text
Ctrl + C
```

Puis attendre la fermeture. Tu peux aussi fermer la fenetre si necessaire.

## 16. Lancement automatique Windows

Option simple :

1. appuyer sur `Win + R` ;
2. taper `shell:startup` ;
3. creer un raccourci vers `tools/led-bridge/LANCER.bat` ;
4. redemarrer le PC pour tester.

Avant la soiree, verifie quand meme que le bridge se lance bien et que le panneau se connecte.

## Test complet avant la soiree

```text
[ ] Les quatre panneaux sont charges
[ ] Le Bluetooth du PC est active
[ ] iPixel Color est completement ferme
[ ] Aucun panneau n'est connecte a un telephone
[ ] INSTALLER.bat a ete lance sans erreur
[ ] service-account.json est present
[ ] config.json contient les quatre adresses Bluetooth
[ ] TESTER.bat affiche #27 PRET
[ ] LANCER.bat affiche Firebase connecte
[ ] Une fausse commande passe de recue a prete
[ ] Le numero apparait sur le mur LED
[ ] Le programme redemarre correctement
[ ] La page #stand fonctionne meme si le bridge est ferme
```

## Commandes developpeur

Depuis `tools/led-bridge` :

```bat
.venv\Scripts\python.exe -m unittest discover -s tests
.venv\Scripts\python.exe bridge.py --render-samples --dry-run
.venv\Scripts\python.exe bridge.py --test 27 ready --dry-run
```

## Notes techniques

- Le bridge utilise `google-auth` + REST streaming Firebase, pas Firebase Admin SDK, pour eviter une dependance plus lourde.
- Le navigateur n'appelle plus `127.0.0.1`, donc pas de probleme de mixed content ou de CORS.
- Les PNG principaux sont generes en `64 x 64`.
- Le controleur `LedWallController` decoupe automatiquement en quatre images `32 x 32`.
- Les GIF ne sont plus utilises.
- Les secrets locaux sont ignores par Git : `config.json`, `service-account.json`, `.venv`.
