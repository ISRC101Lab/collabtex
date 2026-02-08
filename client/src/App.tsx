import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout';
import Toast from '@/components/common/Toast';
import Spinner from '@/components/common/Spinner';

const LoginPage = React.lazy(() => import('@/pages/LoginPage'));
const ProjectListPage = React.lazy(() => import('@/pages/ProjectListPage'));
const EditorPage = React.lazy(() => import('@/pages/EditorPage'));

function SuspenseFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <Spinner size="lg" />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<SuspenseFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<AppShell />}>
            <Route index element={<ProjectListPage />} />
            <Route path="project/:id" element={<EditorPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toast />
    </BrowserRouter>
  );
}
