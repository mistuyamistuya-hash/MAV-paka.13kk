# Vortex

Salon de discussion Vortex en français, hébergé sur GitHub Pages et connecté à Supabase pour les comptes et les salons de discussion.

## Configuration Supabase

Le projet utilise le Project URL et la clé publique `sb_publishable_…` dans `cloud.js`. Cette clé est destinée au navigateur; ne mets jamais une clé `sb_secret_…` ou `service_role` dans le dépôt.

Dans le SQL Editor du projet Supabase, exécute une fois le contenu de [`supabase-setup.sql`](./supabase-setup.sql). Le script crée les profils, les messages, les politiques RLS et active les mises à jour temps réel. Les nouveaux comptes reçoivent toujours le rôle Membre; le navigateur ne peut pas modifier les rôles.

Dans **Authentication → URL Configuration**, ajoute `https://mistuyamistuya-hash.github.io/MAV-paka.13kk/` aux URL de redirection autorisées. Définis aussi cette adresse comme Site URL si elle n’est pas déjà configurée.

Pour accorder le rôle Général au propriétaire initial, remplace l’adresse par celle du compte créé, puis exécute cette requête depuis le SQL Editor Supabase :

```sql
update public.profiles
set role = 'general'
where id = (select id from auth.users where email = 'TON-EMAIL');
```

N’exécute cette promotion que pour le compte de confiance qui administrera le salon. Les changements de rôle doivent être faits côté Supabase, jamais depuis le site public.

## GitHub Pages

Le workflow [`deploy-pages.yml`](./.github/workflows/deploy-pages.yml) publie automatiquement le site après chaque envoi sur `main` ou `master`. La source GitHub Pages doit être configurée sur **GitHub Actions** dans **Settings → Pages**.

## Portée actuelle

Les comptes et les salons Général / entre-chefs sont partagés via Supabase. L’inscription peut nécessiter la confirmation de l’adresse e-mail selon les réglages Auth du projet. Les fichiers, vidéos, réunions, présence et messages privés restent des fonctions locales/de démonstration et ne sont pas synchronisés entre appareils.
