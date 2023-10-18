# kind-openobserve-action

[![test](https://github.com/FNNDSC/kind-openobserve-action/actions/workflows/test.yml/badge.svg)](https://github.com/FNNDSC/kind-openobserve-action/actions/workflows/test.yml)
[![MIT License](https://img.shields.io/github/license/fnndsc/kind-openobserve-action)](./LICENSE)

A GitHub Action for advanced testing of Kubernetes workloads in GitHub Actions.
It creates a Kubernetes cluster using [Kubernetes-in-Docker (KinD)](https://kind.sigs.k8s.io/)
and installs [Vector](https://vector.dev) using [Helm](https://helm.sh/) so that
Kubernetes logs and metrics can be shipped to [OpenObserve](https://openobserve.ai) for debugging.

To see an example, look at the self-test in
[.github/workflows/test.yml](.github/workflows/test.yml).
