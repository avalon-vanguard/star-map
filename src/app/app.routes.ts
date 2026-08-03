import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/galaxy-system/galaxy-system-scene.component').then((m) => m.GalaxySystemSceneComponent)
  },
  {
    path: 'body/:id',
    loadComponent: () => import('./features/body-detail/body-detail-scene.component').then((m) => m.BodyDetailSceneComponent)
  }
];
