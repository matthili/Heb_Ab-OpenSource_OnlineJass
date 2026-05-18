{{/*
Helm-Helpers für jass-app. Standard-Boilerplate aus `helm create`,
angepasst auf unsere Komponenten-Namen (api, inference, web, landing).
*/}}

{{- define "jass-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "jass-app.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "jass-app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Gemeinsame Labels für jede Ressource. */}}
{{- define "jass-app.labels" -}}
helm.sh/chart: {{ include "jass-app.chart" . }}
{{ include "jass-app.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "jass-app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "jass-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "jass-app.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "jass-app.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Pro-Komponente: Component-Label (für Selector + Discovery) */}}
{{- define "jass-app.component.labels" -}}
{{ include "jass-app.labels" . }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "jass-app.component.selectorLabels" -}}
{{ include "jass-app.selectorLabels" . }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Voller Name eines Component-Workloads: <release>-<chart>-<component> */}}
{{- define "jass-app.component.fullname" -}}
{{- printf "%s-%s" (include "jass-app.fullname" .) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}
