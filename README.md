# Vortex

Maquette locale d’un salon de discussion en français, réalisée en HTML, CSS et JavaScript.

## Publier sur GitHub Pages

1. Crée un dépôt GitHub pour Vortex et ajoute les fichiers du projet (`index.html`, `styles.css`, `script.js`, `.github/workflows/deploy-pages.yml` et ce fichier).
2. Dans **Settings → Pages**, choisis **GitHub Actions** comme source de publication.
3. Envoie les fichiers sur la branche `main` ou `master`. Le workflow publiera automatiquement le site.
4. Récupère l’adresse publique dans **Settings → Pages** ou dans l’exécution terminée de l’action **Publier Vortex sur GitHub Pages**.

Le dépôt doit contenir uniquement des fichiers que tu acceptes de rendre publics.

## Limites actuelles

GitHub Pages héberge uniquement le site statique. Les messages, profils, médias et fichiers sont enregistrés dans le navigateur de chaque visiteur; ils ne sont pas partagés entre appareils. Les rôles de cette maquette ne constituent pas un contrôle d’accès sécurisé.

Pour créer un salon réellement partagé, il faudra connecter un service backend comme Supabase, activer des règles de sécurité côté serveur et déployer/configurer ce backend séparément. Ne publie jamais de clé secrète ou `service_role` dans le dépôt.
