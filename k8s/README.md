# RoomKit k8s deployment

Deploys to the k3s cluster under namespace `roomkit`, exposed at
`https://rk.dshs.app` (TLS via the cluster-wide `letsencrypt-prod` issuer).

## Routing (single host, path-based)

| Path         | Backend        | Notes                                    |
| ------------ | -------------- | ---------------------------------------- |
| `/api`       | server:3000    | NestJS REST API (global prefix)          |
| `/socket.io` | server:3000    | socket.io gateways                       |
| `/roomkit`   | minio:9000     | path-style presigned S3 URLs             |
| `/`          | studio:80      | SvelteKit SSR                            |

Postgres and MinIO run in-cluster on `local-path` PVCs (single replica,
`Recreate` strategy).

## First deploy

```sh
cp k8s/.env.prod.example k8s/.env.prod   # fill in secrets
k8s/build.sh                             # build+push server/studio images
k8s/deploy.sh                            # apply manifests, roll out
```

`deploy.sh` syncs `.env.prod` into the `roomkit-secrets` secret on every
run. The `ghcr-secret` image pull secret was copied once from the `dshs`
namespace; recreate it manually if the namespace is ever rebuilt:

```sh
kubectl get secret ghcr-secret -n dshs -o json |
  jq 'del(.metadata.namespace, .metadata.resourceVersion, .metadata.uid, .metadata.creationTimestamp)' |
  kubectl apply -n roomkit -f -
```

## Redeploy after code changes

```sh
k8s/build.sh && k8s/deploy.sh
```

The studio image bakes `PUBLIC_API_URL=https://rk.dshs.app` at build time
(override with `PUBLIC_API_URL=... k8s/build.sh`); changing it requires an
image rebuild, not just a redeploy.
