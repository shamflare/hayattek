"use client";

import { useParams } from "next/navigation";

import { DicomViewerPage } from "@/components/imaging/dicom-viewer";

/** Patient-portal imaging viewer: no practice context; the API applies patient/guardian rules. */
export default function MyImagingViewerPage() {
  const { documentId } = useParams<{ documentId: string }>();
  return <DicomViewerPage documentId={documentId} portal back="/app/me/documents" />;
}
