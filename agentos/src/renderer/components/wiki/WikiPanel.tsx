import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDragResize } from '../../hooks/useDragResize';
import type { WikiPage } from '../../../shared/types';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WikiPageList } from './WikiPageList';
import { WikiPageEditor } from './WikiPageEditor';

interface Props {
  projectPath: string;
}

export function WikiPanel({ projectPath }: Props) {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: wikiWidth, handleMouseDown: wikiMouseDown } = useDragResize({
    defaultWidth: 208,
    minWidth: 140,
    maxWidth: 380,
    storageKey: 'agentos:wikiSidebarWidth',
  });

  const selectedPage = pages.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    setLoading(true);
    window.electronAPI.wiki
      .list(projectPath)
      .then(setPages)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectPath]);

  useEffect(() => {
    if (!selectedPage) return;
    setTitle(selectedPage.title);
    setContent(selectedPage.content);
    setEditing(false);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    async (updatedTitle: string, updatedContent: string) => {
      if (!selectedId) return;
      const existing = pages.find((p) => p.id === selectedId);
      if (!existing) return;
      setSaving(true);
      try {
        const saved = await window.electronAPI.wiki.save(projectPath, {
          ...existing,
          title: updatedTitle,
          content: updatedContent,
        });
        setPages((prev) => prev.map((p) => (p.id === saved.id ? saved : p)).sort((a, b) => b.updatedAt - a.updatedAt));
      } catch (err) {
        console.error('Wiki save failed', err);
      } finally {
        setSaving(false);
      }
    },
    [selectedId, pages, projectPath]
  );

  function scheduleSave(newTitle: string, newContent: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(newTitle, newContent), 600);
  }

  async function handleNewPage() {
    const id = `wiki-${Date.now()}`;
    const now = Date.now();
    const page: WikiPage = { id, title: 'Untitled', content: '', createdAt: now, updatedAt: now };
    try {
      const saved = await window.electronAPI.wiki.save(projectPath, page);
      setPages((prev) => [saved, ...prev]);
      setSelectedId(saved.id);
      setEditing(true);
    } catch (err) {
      console.error('Wiki create failed', err);
    }
  }

  async function doDelete(pageId: string) {
    setConfirmDeleteId(null);
    try {
      await window.electronAPI.wiki.delete(projectPath, pageId);
      setPages((prev) => prev.filter((p) => p.id !== pageId));
      if (selectedId === pageId) setSelectedId(null);
    } catch (err) {
      console.error('Wiki delete failed', err);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete page"
        description="This wiki page will be permanently deleted."
        confirmLabel="Delete"
        onConfirm={() => confirmDeleteId && void doDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
      <WikiPageList
        pages={pages}
        selectedId={selectedId}
        loading={loading}
        width={wikiWidth}
        onSelect={setSelectedId}
        onCreate={() => void handleNewPage()}
        onDelete={(id) => setConfirmDeleteId(id)}
        onDragHandleMouseDown={wikiMouseDown}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <WikiPageEditor
          selectedPage={selectedPage}
          hasPages={pages.length > 0}
          editing={editing}
          title={title}
          content={content}
          saving={saving}
          onTitleChange={(v) => {
            setTitle(v);
            scheduleSave(v, content);
          }}
          onContentChange={(v) => {
            setContent(v);
            scheduleSave(title, v);
          }}
          onToggleEdit={() => setEditing((v) => !v)}
        />
      </div>
    </div>
  );
}
