// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.2"),
        .package(name: "CapawesomeCapacitorNodejs", path: "../../../../../node_modules/.pnpm/@capawesome+capacitor-nodejs@0.2.0_@capacitor+core@8.5.2/node_modules/@capawesome/capacitor-nodejs")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapawesomeCapacitorNodejs", package: "CapawesomeCapacitorNodejs")
            ]
        )
    ]
)
