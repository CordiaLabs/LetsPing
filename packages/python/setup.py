from setuptools import setup, find_packages

setup(
    name="letsping",
    version="0.1.0-beta",
    description="The Human-in-the-Loop Protocol for AI Agents",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Cordia Labs",
    author_email="hello@letsping.co",
    url="https://github.com/cordialabs/letsping",
    packages=find_packages(),
    install_requires=[
        "requests>=2.31.0",
        "pydantic>=2.5.0",
        "typing-extensions>=4.9.0"
    ],
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Scientific/Engineering :: Artificial Intelligence"
    ],
    python_requires=">=3.9",
)