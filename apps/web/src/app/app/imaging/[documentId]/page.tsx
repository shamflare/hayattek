"use client";

import { useParams } from "next/navigation";

import { DicomViewerPage } from "@/components/imaging/dicom-viewer";

/** Staff imaging viewer (practice context). Permission checks happen in the API. */
export default function ImagingViewerPage() {
  const { documentId } = useParams<{ documentId: string }>();
  return <DicomViewerPage documentId={documentId} />;
}
