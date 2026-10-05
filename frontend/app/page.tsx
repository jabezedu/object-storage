'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';

interface Bucket {
  id: number;
  name: string;
  created_at: string;
  object_count: number;
  total_size: number;
  estimated_monthly_cost: number;
}

interface S3Object {
  id: number;
  bucket_id: number;
  name: string;
  size_bytes: number;
  content_type: string;
  storage_class: 'Standard' | 'Infrequent';
  created_at: string;
}

export default function ObjectStorageDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);
  const [objects, setObjects] = useState<S3Object[]>([]);

  const [newBucketName, setNewBucketName] = useState('');
  const [bucketError, setBucketError] = useState('');
  const [isCreatingBucket, setIsCreatingBucket] = useState(false);

  // File upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [storageClass, setStorageClass] = useState<'Standard' | 'Infrequent'>('Standard');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Delete bucket confirmation modal
  const [bucketToDelete, setBucketToDelete] = useState<Bucket | null>(null);
  const [deleteConfirmError, setDeleteConfirmError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (!token) {
      router.push('/login');
      return;
    }
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    fetchBuckets();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  const fetchBuckets = async () => {
    try {
      const res = await apiFetch('/api/buckets');
      if (res.ok) {
        const data = await res.json();
        setBuckets(data);
        if (selectedBucket) {
          const updated = data.find((b: Bucket) => b.id === selectedBucket.id);
          if (updated) setSelectedBucket(updated);
        }
      }
    } catch (err) {
      console.error('Failed to load buckets', err);
    }
  };

  const fetchObjects = async (bucketId: number) => {
    try {
      const res = await apiFetch(`/api/buckets/${bucketId}/objects`);
      if (res.ok) {
        const data = await res.json();
        setObjects(data.objects);
      }
    } catch (err) {
      console.error('Failed to load objects', err);
    }
  };

  const handleSelectBucket = (bucket: Bucket) => {
    setSelectedBucket(bucket);
    fetchObjects(bucket.id);
  };

  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    setBucketError('');
    setIsCreatingBucket(true);

    try {
      const res = await apiFetch('/api/buckets', {
        method: 'POST',
        body: JSON.stringify({ name: newBucketName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create bucket');
      }
      setNewBucketName('');
      await fetchBuckets();
      handleSelectBucket(data);
    } catch (err: any) {
      setBucketError(err.message);
    } finally {
      setIsCreatingBucket(false);
    }
  };

  const handleDeleteBucketPrompt = (bucket: Bucket) => {
    if (bucket.object_count > 0) {
      setBucketToDelete(bucket);
      setDeleteConfirmError('');
    } else {
      executeDeleteBucket(bucket.id, false);
    }
  };

  const executeDeleteBucket = async (bucketId: number, force: boolean) => {
    try {
      const res = await apiFetch(`/api/buckets/${bucketId}${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete bucket');
      }
      setBucketToDelete(null);
      if (selectedBucket?.id === bucketId) {
        setSelectedBucket(null);
        setObjects([]);
      }
      await fetchBuckets();
    } catch (err: any) {
      setDeleteConfirmError(err.message);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !selectedBucket) return;

    if (uploadFile.size > 2 * 1024 * 1024) {
      setUploadError('File size exceeds the 2MB limit.');
      return;
    }

    setUploadError('');
    setIsUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = reader.result as string;
          const base64Data = result.split(',')[1];
          const res = await apiFetch(`/api/buckets/${selectedBucket.id}/objects`, {
            method: 'POST',
            body: JSON.stringify({
              name: uploadFile.name,
              contentType: uploadFile.type || 'application/octet-stream',
              storageClass,
              base64Data,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Upload failed');
          }
          setUploadFile(null);
          await fetchObjects(selectedBucket.id);
          await fetchBuckets();
        } catch (err: any) {
          setUploadError(err.message);
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(uploadFile);
    } catch (err: any) {
      setUploadError(err.message);
      setIsUploading(false);
    }
  };

  const handleDownloadObject = async (obj: S3Object) => {
    if (!selectedBucket) return;
    try {
      const token = localStorage.getItem('token');
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4001';
      const res = await fetch(`${baseUrl}/api/buckets/${selectedBucket.id}/objects/${obj.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = obj.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  const handleDeleteObject = async (objectId: number) => {
    if (!selectedBucket) return;
    if (!confirm('Are you sure you want to delete this object?')) return;
    try {
      const res = await apiFetch(`/api/buckets/${selectedBucket.id}/objects/${objectId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchObjects(selectedBucket.id);
        await fetchBuckets();
      }
    } catch (err) {
      console.error('Failed to delete object', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-bold shadow-sm">
              S3
            </div>
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-white leading-none">Cloud Object Storage</h1>
              <span className="text-xs text-slate-500 dark:text-slate-400">Object Storage Service</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline-block">
              {user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Buckets */}
        <div className="space-y-6">
          {/* Create Bucket Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-2">Create Bucket</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Bucket names must be 3-30 lowercase characters, numbers or hyphens.
            </p>
            {bucketError && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-3">{bucketError}</p>
            )}
            <form onSubmit={handleCreateBucket} className="space-y-3">
              <input
                type="text"
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value.toLowerCase())}
                placeholder="my-cool-bucket"
                required
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              />
              <button
                type="submit"
                disabled={isCreatingBucket || !newBucketName.trim()}
                className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50"
              >
                {isCreatingBucket ? 'Creating...' : '+ New Bucket'}
              </button>
            </form>
          </div>

          {/* Buckets List Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Buckets ({buckets.length})</h2>
              <button
                onClick={fetchBuckets}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Refresh
              </button>
            </div>

            {buckets.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
                No buckets created yet.
              </div>
            ) : (
              <div className="space-y-2">
                {buckets.map((bucket) => {
                  const isSelected = selectedBucket?.id === bucket.id;
                  return (
                    <div
                      key={bucket.id}
                      onClick={() => handleSelectBucket(bucket)}
                      className={`cursor-pointer rounded-lg border p-3 transition flex flex-col gap-1 ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/20'
                          : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-slate-900 dark:text-white break-all">
                          {bucket.name}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteBucketPrompt(bucket);
                          }}
                          className="text-xs text-red-500 hover:text-red-700 p-1"
                          title="Delete bucket"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50 text-[11px] text-slate-500 dark:text-slate-400">
                        <div>
                          <span className="block text-[10px] text-slate-400 uppercase">Objects</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{bucket.object_count}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-400 uppercase">Total Size</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{formatBytes(bucket.total_size)}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-400 uppercase">Cost/Mo</span>
                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                            ${bucket.estimated_monthly_cost.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Objects in Selected Bucket */}
        <div className="lg:col-span-2 space-y-6">
          {selectedBucket ? (
            <>
              {/* Bucket details header */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wider">Active Bucket</span>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white break-all">{selectedBucket.name}</h2>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Created: {new Date(selectedBucket.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-2.5 px-4 border border-slate-100 dark:border-slate-700">
                      <div className="text-xs text-slate-500">Storage Used</div>
                      <div className="text-sm font-bold text-slate-800 dark:text-slate-200">{formatBytes(selectedBucket.total_size)}</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-2.5 px-4 border border-blue-100 dark:border-blue-900/40">
                      <div className="text-xs text-blue-600 dark:text-blue-400">Monthly Est.</div>
                      <div className="text-sm font-bold text-blue-700 dark:text-blue-300">${selectedBucket.estimated_monthly_cost.toFixed(4)}</div>
                    </div>
                  </div>
                </div>

                {/* Upload Form */}
                <form onSubmit={handleFileUpload} className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Upload Object (Max 2MB)</h3>
                  {uploadError && <p className="text-xs text-red-500 mb-2">{uploadError}</p>}
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                    <input
                      type="file"
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      className="block w-full text-xs text-slate-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-700 dark:file:text-blue-400"
                    />
                    <select
                      value={storageClass}
                      onChange={(e) => setStorageClass(e.target.value as any)}
                      className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs px-3 py-2 text-slate-900 dark:text-white focus:outline-none"
                    >
                      <option value="Standard">Standard ($0.023/GB)</option>
                      <option value="Infrequent">Infrequent ($0.0125/GB)</option>
                    </select>
                    <button
                      type="submit"
                      disabled={isUploading || !uploadFile}
                      className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition disabled:opacity-50 whitespace-nowrap"
                    >
                      {isUploading ? 'Uploading...' : 'Upload'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Objects Table */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
                  Objects in Bucket ({objects.length})
                </h3>
                {objects.length === 0 ? (
                  <div className="text-center py-12 text-xs text-slate-500 dark:text-slate-400">
                    No objects uploaded yet in this bucket.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                      <thead className="border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="py-2 px-3">Name</th>
                          <th className="py-2 px-3">Size</th>
                          <th className="py-2 px-3">Content Type</th>
                          <th className="py-2 px-3">Class</th>
                          <th className="py-2 px-3">Uploaded</th>
                          <th className="py-2 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                        {objects.map((obj) => (
                          <tr key={obj.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                            <td className="py-3 px-3 font-medium text-slate-900 dark:text-white max-w-xs truncate">
                              {obj.name}
                            </td>
                            <td className="py-3 px-3">{formatBytes(obj.size_bytes)}</td>
                            <td className="py-3 px-3 text-slate-500 font-mono text-[11px]">{obj.content_type}</td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  obj.storage_class === 'Standard'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                }`}
                              >
                                {obj.storage_class}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-slate-400">
                              {new Date(obj.created_at).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-3 text-right space-x-2">
                              <button
                                onClick={() => handleDownloadObject(obj)}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                              >
                                Download
                              </button>
                              <button
                                onClick={() => handleDeleteObject(obj.id)}
                                className="text-red-500 hover:text-red-700 font-medium"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="h-64 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <svg className="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm font-medium">Select a bucket or create a new one to view and upload objects.</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Non-Empty Bucket Deletion */}
      {bucketToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Non-Empty Bucket</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Bucket <span className="font-semibold text-slate-900 dark:text-white">{bucketToDelete.name}</span> currently contains{' '}
              <span className="font-semibold text-red-600 dark:text-red-400">{bucketToDelete.object_count}</span> object(s). Deleting it will permanently delete all stored objects.
            </p>
            {deleteConfirmError && (
              <p className="mt-2 text-xs text-red-500">{deleteConfirmError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setBucketToDelete(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => executeDeleteBucket(bucketToDelete.id, true)}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                Confirm Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
